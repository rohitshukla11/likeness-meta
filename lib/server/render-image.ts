import "server-only";
/**
 * One image ad, end to end:
 *   checks (licence active and held by this brand, under its cap, brand has the credits, daily cap)
 *   → prompt safety filter (keyword rules, then the BrandAgent's model check) → the creator's frames
 *   opened for this render (logged) → image generation (ImageGenerator, lib/server/ai: Gemini or Muse
 *   Image per AI_PROVIDER) → consent gate (lib/server/consentGate.ts: exactly one person, the creator's
 *   face visible and matching; a blocked image is never delivered or charged, but its cost is kept in
 *   blockedRenders) → output reviewer (OutputReviewer: a licence violation blocks like the gate, a brief
 *   mismatch flags) → visible "AI-generated" label → C2PA manifest → sha256 → KMS-signed receipt →
 *   one Firestore transaction: debit the brand, credit the creator (minus the 10% fee), count the
 *   render, store the render and its receipt → file to the private bucket.
 * Nothing is charged unless the whole render succeeds. Every step is written to the render step log
 * (lib/server/renderLog.ts) as it finishes; with a requestId the request is idempotent
 * (lib/server/idempotency.ts).
 */
import { blockedSentence } from "@/lib/reasons";
import { createHash, randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import sharp from "sharp";
import { capRefusal, creatorFee, licenceStatus, useLabel, type DailyCaps, type DailyUsage, type LicenceDoc, type ReceiptPayload } from "@/lib/model";
import type { Aspect } from "@/lib/creative";
import { ai, aiProvider, assertAspect } from "./ai";
import { isBudgetStop } from "./ai/budget";
import { planWithAlternatives, proposeAlternative } from "./ai/alternative";
import type { BrandAgent, CallMetrics, GeneratedImage, ReviewResult, ShotProposal } from "./ai/types";
import { renderCost, showModelCost, type RenderCost, type RenderStep } from "./ai/pricing";
import { embedManifest } from "./c2pa";
import { runConsentGate, type ConsentResult } from "./consentGate";
import { getCreator } from "./creators";
import { dailyCapsFor, judgeRegistryCached } from "./demo";
import { referenceEmbeddings } from "./facematch";
import { checkPrompt, type FilterResult } from "./filter";
import { firestore } from "./firebase-admin";
import { HttpError } from "./http";
import { claimRender, finishClaim, fingerprintOf, renderIdFor } from "./idempotency";
import { labelRender } from "./label";
import { getLicence } from "./licences";
import { signPayload } from "./receipts";
import { fromMetrics, RenderLog } from "./renderLog";
import { deleteObject, putObject } from "./storage";
import { ruleCheck } from "./rules";
import { openFrames } from "./vault";

const db = () => firestore();
export const rendersPerDay = () => Number(process.env.RENDERS_PER_DAY ?? 40);
export const dailyCaps = (): DailyCaps => ({ siteRenders: rendersPerDay(), brandRenders: Number(process.env.BRAND_RENDERS_PER_DAY ?? 3) });
/** Today's counts: site-wide in usage/{day}, per brand in usage/{day}/brands/{uid}. */
const usageRefs = (brandUid: string) => {
  const site = db().collection("usage").doc(day());
  return { site, brand: site.collection("brands").doc(brandUid) };
};
const counts = (d: FirebaseFirestore.DocumentData | undefined): DailyUsage => ({ renders: Number(d?.renders ?? 0), blocked: Number(d?.blocked ?? 0) });
/**
 * Test runs (the eval brand's renders and development fixture renders) don't use the site-wide daily limit:
 * they aren't counted toward it and aren't refused by it. Their own brand limit still applies, and the admin
 * view still lists them.
 */
const NOT_COUNTED: DailyUsage = { renders: 0, blocked: 0 };
export const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

export type RenderDoc = {
  id: string;
  licenceId: string;
  brandId: string;
  creatorId: string;
  type: "image";
  renderIndex: number;
  sha256: string;
  mime: string;
  object: string;
  model: string;
  price: number;
  creatorShare: number;
  fee: number;
  brief: string;
  createdAt: number;
  /** A small labelled preview for the dashboards. */
  previewObject?: string;
  aspect?: Aspect;
  /** The consent gate's result: counts, scores and the segmenter used; never pixels, masks or embeddings. */
  consent?: ConsentRecord;
  /** Every model call this render made and its estimated cost (lib/server/ai/pricing.ts). */
  cost?: RenderCost;
  /** The output reviewer's verdict: "flag" means delivered with a warning; "pass" or skipped otherwise. */
  review?: ReviewRecord;
  /** The prompt actually rendered, when the brand agent wrote it from the brief (AI_PROVIDER=meta). */
  prompt?: string;
  /** Made with AI_PROVIDER=fixture (development): left out of the brand's and creator's lists, never shown in the demo. */
  fixture?: true;
  /** Made by the eval brand (scripts/eval.ts, scripts/render-check.ts): left out of the creator's lists, payout reversed. */
  evalRun?: true;
  /** The flagged render this one is the brand's alternative to. */
  alternativeOf?: string;
  /** On a flagged render: the alternative the brand asked for (one at most), claimed before anything is spent. */
  alternativeId?: string;
};

/** A development render (AI_PROVIDER=fixture): its model is "fixture:<file>". */
export const isFixtureModel = (model: string) => model.startsWith("fixture:");

/** The ledger reason for the creator's entry that cancels a development render's payout. */
export const FIXTURE_REVERSAL_REASON = "Reversal of development test renders";
/** The same for the eval brand's renders (automated test runs with real models). */
export const EVAL_REVERSAL_REASON = "Reversal of evaluation run (automated test)";
/** The creator's photo-access entry for an eval-brand render. */
export const EVAL_ACCESS_LABEL = "Evaluation run (automated test)";

export type ReviewRecord = Pick<ReviewResult, "verdict" | "reasons"> & { skipped: boolean };
const reviewRecord = (r: ReviewResult): ReviewRecord => ({ verdict: r.verdict, reasons: r.reasons, skipped: !!r.skipped });

/**
 * An image the consent gate blocked after the paid image call: never delivered and never charged to
 * the brand, but its provider cost is kept, so cost figures include blocked renders. blockedRenders/{id}.
 */
export type BlockedRenderDoc = {
  id: string;
  licenceId: string;
  brandId: string;
  creatorId: string;
  brief: string;
  model: string;
  createdAt: number;
  charged: 0;
  /** Which check blocked it: the consent gate, the reviewer, or the payment step (the licence changed, credits, limits). */
  blockedBy: "consent" | "review" | "payment";
  /** The reason code, for blocks at payment (LICENCE_REVOKED, …); consent and review blocks carry theirs in consent / review. */
  code?: string;
  consent: ConsentRecord;
  review?: ReviewRecord;
  cost: RenderCost;
  /** Made with AI_PROVIDER=fixture (development): shown in the admin view only. */
  fixture?: true;
  /** Made by the eval brand: left out of the creator's lists. */
  evalRun?: true;
};

/**
 * The brand's alternative to a flagged render ("Ask for an alternative"): one per flagged image, claimed in a
 * transaction before anything is spent. The brand agent proposes one alternative shot for the reviewer's
 * findings under the same rules as before (the policy code decides; the policy check, the consent gate and
 * the reviewer run again), and it is rendered and charged as a new render under the same licence.
 */
export async function renderAlternative(brandUid: string, renderId: string, requestId: string): Promise<RenderResult> {
  const ref = db().collection("renders").doc(renderId);
  const newId = renderIdFor(brandUid, requestId);
  const r = await db().runTransaction(async (tx) => {
    const r = (await tx.get(ref)).data() as RenderDoc | undefined;
    if (!r || r.brandId !== brandUid) throw new RenderRefused(404, "no such render", undefined, "NO_RENDER");
    if (r.review?.verdict !== "flag" || r.alternativeOf) throw new RenderRefused(409, "only an image the output review flagged can have an alternative", undefined, "NOT_FLAGGED");
    if (r.alternativeId && r.alternativeId !== newId) throw new RenderRefused(409, "this image has already had its alternative", undefined, "ALTERNATIVE_USED");
    if (!r.alternativeId) tx.update(ref, { alternativeId: newId });
    return r;
  });
  const licence = await getLicence(r.licenceId);
  if (!licence) throw new RenderRefused(404, "no such licence", undefined, "NO_LICENCE");
  const aspect = r.aspect ?? "1:1";
  assertAspect(aspect);
  const flagged: ShotProposal = { id: "flagged", prompt: r.prompt ?? r.brief, aspect, rationale: "the flagged image's shot" };
  const alt = await proposeAlternative(ai().brandAgent, flagged, { code: "REVIEW_FLAG", explanation: r.review!.reasons.join(" ") }, licence, ruleCheck);
  if (!alt?.decision.allowed || !alt.shot) throw new RenderRefused(422, `No alternative could be proposed: ${alt?.decision.explanation ?? "this AI provider has no brand agent for alternatives"}`, undefined, alt?.decision.code ?? "MODEL_REFUSED");
  return renderImage(brandUid, r.licenceId, alt.shot.prompt, aspect, { requestId, alternative: { of: renderId, shot: alt.shot } });
}

/** Why a render was blocked, in plain language, for the dashboards and the admin view. Pure. */
export function blockedReason(b: Pick<BlockedRenderDoc, "blockedBy" | "code" | "consent" | "review">): { code: string | null; explanation: string } {
  if (b.blockedBy === "payment") return { code: b.code ?? null, explanation: "Refused at payment after the image was made: the licence, the credits or a limit changed during the render." };
  if (b.blockedBy === "review") return { code: b.code ?? "REVIEW_BLOCKED", explanation: (b.review?.reasons ?? []).join(" ") };
  return { code: b.code ?? b.consent?.code ?? null, explanation: b.consent?.explanation ?? "" };
}

/** Development renders, delivered or blocked, by their flag or (older records) their model name. */
export const isFixtureRecord = (r: { fixture?: true; model: string }) => !!r.fixture || isFixtureModel(r.model);

export type ConsentRecord = Pick<ConsentResult, "code" | "explanation" | "people" | "faces" | "similarity" | "threshold" | "segmenter" | "figure">;
const consentRecord = ({ code, explanation, people, faces, similarity, threshold, segmenter, figure }: ConsentResult): ConsentRecord => ({
  code,
  explanation,
  people,
  faces,
  similarity,
  threshold,
  segmenter,
  figure,
});

export class RenderRefused extends HttpError {
  constructor(
    status: number,
    message: string,
    readonly filter?: FilterResult,
    /** A reason code for the step log and the UI (LICENCE_REVOKED, FACE_MISMATCH, …; lib/reasons.ts). */
    code?: string,
  ) {
    super(status, message, code);
  }
}

/** A render as the browser sees it: the private storage paths stay on the server. */
export function publicRender(r: RenderDoc) {
  const { object: _o, previewObject: _p, cost, ...pub } = r;
  (void _o, void _p);
  return { ...pub, ...(cost && showModelCost() ? { cost } : {}), hasPreview: !!r.previewObject };
}

/** Checks before a render. Returns the licence and price. */
export async function preflight(brandUid: string, licenceId: string): Promise<{ licence: LicenceDoc; price: number; caps: DailyCaps }> {
  const l = await getLicence(licenceId);
  if (!l) throw new RenderRefused(404, "no such licence", undefined, "NO_LICENCE");
  if (l.brandId !== brandUid) throw new RenderRefused(403, "this licence belongs to another brand", undefined, "NOT_YOUR_LICENCE");
  const status = licenceStatus(l);
  const statusCode = { Revoked: "LICENCE_REVOKED", Expired: "LICENCE_EXPIRED", Exhausted: "OVER_CAP", Active: "" }[status];
  if (status !== "Active") throw new RenderRefused(409, `render refused: the licence is ${status.toLowerCase()}`, undefined, statusCode);
  const price = l.pricePerImage;
  const refs = usageRefs(brandUid);
  // Credits, today's usage and the judge registry are independent reads: in parallel.
  const [credits, site, brand, judges] = await Promise.all([db().collection("credits").doc(brandUid).get(), refs.site.get(), refs.brand.get(), judgeRegistryCached()]);
  const bal = Number(credits.data()?.balance ?? 0);
  if (bal < price) throw new RenderRefused(402, `not enough demo credits: this image costs ${price}, you have ${bal}`, undefined, "NO_CREDITS");
  const caps = dailyCapsFor(brandUid, judges, dailyCaps());
  const testRun = aiProvider() === "fixture" || judges?.evalBrandUid === brandUid;
  const capped = capRefusal(testRun ? NOT_COUNTED : counts(site.data()), counts(brand.data()), caps);
  if (capped) throw new RenderRefused(429, capped, undefined, "DAILY_LIMIT");
  return { licence: l, price, caps };
}

/** Charge and record a finished render atomically; refuses if the licence changed meanwhile. */
export async function settle(input: {
  brandUid: string;
  licence: LicenceDoc;
  bytes: Uint8Array;
  mime: string;
  model: string;
  brief: string;
  renderId: string;
  previewObject?: string;
  aspect?: RenderDoc["aspect"];
  consent?: ConsentRecord;
  cost?: RenderCost;
  review?: ReviewRecord;
  prompt?: string;
  /** The caps preflight worked out for this brand (the judge brand's own limit); the usual ones if absent. */
  caps?: DailyCaps;
  /** The eval brand's render: the creator's payout is reversed, as for a development render. */
  evalRun?: boolean;
  /** The flagged render this one is the brand's alternative to. */
  alternativeOf?: string;
}): Promise<{ render: RenderDoc; receipt: Awaited<ReturnType<typeof signPayload>> }> {
  const { licence: l0 } = input;
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const price = l0.pricePerImage;
  const payload: ReceiptPayload = {
    v: 1,
    contentSha256: sha256,
    mime: input.mime,
    licenceId: l0.id,
    creatorId: l0.creatorId,
    brandId: l0.brandId,
    use: l0.use,
    renderType: "image",
    renderIndex: l0.renderCount,
    model: input.model,
    price,
    createdAt: Date.now(),
  };
  const receipt = await signPayload(payload);
  const ext = input.mime === "image/png" ? "png" : "jpg";
  const object = `renders/${sha256}.${ext}`;
  await putObject(object, input.bytes, input.mime);
  const { creator: creatorShare, fee } = creatorFee(price);
  const render: RenderDoc = {
    id: input.renderId,
    licenceId: l0.id,
    brandId: l0.brandId,
    creatorId: l0.creatorId,
    type: "image",
    renderIndex: l0.renderCount,
    sha256,
    mime: input.mime,
    object,
    model: input.model,
    price,
    creatorShare,
    fee,
    brief: input.brief,
    createdAt: payload.createdAt,
    ...(input.previewObject ? { previewObject: input.previewObject } : {}),
    ...(input.aspect ? { aspect: input.aspect } : {}),
    ...(input.consent ? { consent: input.consent } : {}),
    ...(input.cost ? { cost: input.cost } : {}),
    ...(input.review ? { review: input.review } : {}),
    ...(input.prompt ? { prompt: input.prompt } : {}),
    ...(isFixtureModel(input.model) ? { fixture: true as const } : {}),
    ...(input.evalRun ? { evalRun: true as const } : {}),
    ...(input.alternativeOf ? { alternativeOf: input.alternativeOf } : {}),
  };
  // Development and evaluation renders pay the creator nothing: the payout is entered and reversed at once.
  const reversal = render.fixture ? FIXTURE_REVERSAL_REASON : render.evalRun ? EVAL_REVERSAL_REASON : null;
  try {
    await settleTransaction();
  } catch (e) {
    await deleteObject(object).catch(() => undefined);
    throw e;
  }
  return { render, receipt };

  async function settleTransaction() {
    await db().runTransaction(async (tx) => {
      const lref = db().collection("licences").doc(l0.id);
      const bref = db().collection("credits").doc(l0.brandId);
      const cref = db().collection("credits").doc(l0.creatorId);
      const { site: uref, brand: buref } = usageRefs(l0.brandId);
      const [ls, bs, cs, us, bus] = await Promise.all([tx.get(lref), tx.get(bref), tx.get(cref), tx.get(uref), tx.get(buref)]);
      const l = ls.data() as LicenceDoc;
      // Re-read inside the transaction: a licence revoked (or ended) while the image was being made is refused here.
      const status = licenceStatus(l);
      const statusCode = { Revoked: "LICENCE_REVOKED", Expired: "LICENCE_EXPIRED", Exhausted: "OVER_CAP", Active: "" }[status];
      if (status !== "Active") throw new RenderRefused(409, `render refused: the licence became ${status.toLowerCase()} during the render; nothing was charged`, undefined, statusCode);
      if (l.renderCount !== l0.renderCount) throw new RenderRefused(409, "another render on this licence finished first; try again", undefined, "RENDER_CONFLICT");
      const bal = Number(bs.data()?.balance ?? 0);
      if (bal < price) throw new RenderRefused(402, "not enough demo credits", undefined, "NO_CREDITS");
      const testRun = !!render.fixture || !!render.evalRun;
      const capped = capRefusal(testRun ? NOT_COUNTED : counts(us.data()), counts(bus.data()), input.caps ?? dailyCaps());
      if (capped) throw new RenderRefused(429, capped, undefined, "DAILY_LIMIT");
      tx.update(lref, { renderCount: l.renderCount + 1 });
      if (price > 0) {
        tx.set(bref, { uid: l0.brandId, balance: bal - price, updatedAt: Date.now() }, { merge: true });
        // A development or evaluation render pays the creator nothing (see `reversal`), so the ledger sums to 0.
        if (!reversal) tx.set(cref, { uid: l0.creatorId, balance: Number(cs.data()?.balance ?? 0) + creatorShare, updatedAt: Date.now() }, { merge: true });
        tx.create(db().collection("ledger").doc(), { uid: l0.brandId, delta: -price, reason: `image render under licence ${l0.id}`, renderId: render.id, licenceId: l0.id, at: Date.now() });
        tx.create(db().collection("ledger").doc(), {
          uid: l0.creatorId,
          delta: creatorShare,
          reason: `image render by ${l0.brandName} (after ${fee} credit fee)`,
          renderId: render.id,
          licenceId: l0.id,
          at: Date.now(),
        });
        if (reversal) tx.create(db().collection("ledger").doc(), { uid: l0.creatorId, delta: -creatorShare, reason: reversal, renderId: render.id, licenceId: l0.id, at: Date.now() });
        tx.create(db().collection("ledger").doc(), { uid: "platform", delta: fee, reason: `10% fee on render ${render.id}`, renderId: render.id, at: Date.now() });
      }
      const inc = { renders: FieldValue.increment(1) };
      if (!testRun) tx.set(uref, inc, { merge: true });
      tx.set(buref, inc, { merge: true });
      tx.create(db().collection("renders").doc(render.id), render);
      tx.create(db().collection("receipts").doc(sha256), { ...receipt, renderId: render.id });
    });
  }
}

/**
 * Pay and deliver, or, if the payment step refuses (the licence was revoked or ended during the render,
 * credits, limits), keep the render's cost in blockedRenders and remove its stored files. Nothing is charged.
 */
export async function payOrBlock(input: Parameters<typeof settle>[0], blocked: Omit<BlockedRenderDoc, "createdAt" | "blockedBy" | "code">): Promise<Awaited<ReturnType<typeof settle>>> {
  try {
    return await settle(input);
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (!(e instanceof RenderRefused)) throw e;
    if (input.previewObject) await deleteObject(input.previewObject).catch(() => undefined);
    await recordBlocked({ ...blocked, createdAt: Date.now(), blockedBy: "payment", ...(typeof code === "string" ? { code } : {}) });
    throw Object.assign(e, { blockedAfterGeneration: true });
  }
}

/** Keep a blocked render's record and count it for the day (site-wide and per brand); nothing is charged. */
async function recordBlocked(doc: BlockedRenderDoc) {
  const { site, brand } = usageRefs(doc.brandId);
  const batch = db().batch();
  const fixture = isFixtureModel(doc.model);
  batch.create(db().collection("blockedRenders").doc(doc.id), fixture ? { ...doc, fixture: true as const } : doc);
  // A test run's blocked image isn't counted toward the site-wide limit (NOT_COUNTED); its brand's limit still is.
  if (!fixture && !doc.evalRun) batch.set(site, { blocked: FieldValue.increment(1) }, { merge: true });
  batch.set(brand, { blocked: FieldValue.increment(1) }, { merge: true });
  await batch.commit();
}

/** The reason code for a refused prompt, from the filter's reasons. */
export function filterCode(f: FilterResult): string {
  if (f.reasons.some((r) => r.startsWith("banned use"))) return "BANNED_USE";
  if (f.reasons.some((r) => r.startsWith("outside the licensed use"))) return "OUTSIDE_LICENSED_USE";
  if (f.reasons.some((r) => r.startsWith("LLM filter"))) return "POLICY_CHECK_FAILED";
  return "EMPTY_BRIEF";
}

export type RenderResult = { renderId: string; render: ReturnType<typeof publicRender>; receipt: { keyVersion: string; alg: string }; filter: Omit<FilterResult, "metrics"> };

/**
 * One image ad. With a requestId (the browser sends one per click) the request is idempotent: a repeat
 * returns the first result or refusal and never generates or charges again. The step log is at
 * renderLogs/{renderId}.
 */
export async function renderImage(brandUid: string, licenceId: string, brief: string, aspectRatio: Aspect = "1:1", opts: { requestId?: string; alternative?: Alternative } = {}): Promise<RenderResult> {
  // A shape the provider can't make is refused first: no planning, policy or image call is spent on it.
  assertAspect(aspectRatio);
  const renderId = opts.requestId ? renderIdFor(brandUid, opts.requestId) : randomBytes(12).toString("base64url");
  if (opts.requestId) {
    const d = await claimRender(renderId, brandUid, fingerprintOf({ licenceId, brief, aspectRatio }));
    if (d.kind === "replay") return d.result as RenderResult;
    if (d.kind === "refuse") throw new RenderRefused(d.status, d.message, undefined, d.code);
  }
  const log = new RenderLog({ id: renderId, brandId: brandUid, licenceId, provider: aiProvider() });
  try {
    const result = await runPipeline(log, renderId, brandUid, licenceId, brief, aspectRatio, opts.alternative);
    if (opts.requestId) await finishClaim(renderId, { result });
    return result;
  } catch (e) {
    const status = typeof (e as { status?: unknown }).status === "number" ? (e as { status: number }).status : 500;
    const code = (e as { code?: unknown }).code;
    const blocked =
      (e as { blockedAfterGeneration?: boolean }).blockedAfterGeneration === true ||
      (typeof code === "string" && ["NO_PERSON", "MULTIPLE_PEOPLE", "FACE_NOT_VISIBLE", "FACE_MISMATCH", "GATE_ERROR", "REVIEW_BLOCKED", "REVIEW_ERROR"].includes(code) && status === 422);
    // A blocked image's full reason is in the error card; the timeline's last line stays short.
    log.finish(blocked ? "blocked" : status < 500 ? "refused" : "error", blocked ? `Image blocked${typeof code === "string" ? ` (${code})` : ""}; not delivered.` : (e as Error).message);
    if (opts.requestId) await finishClaim(renderId, { error: { status, message: (e as Error).message, ...(typeof code === "string" ? { code } : {}) } }).catch(() => undefined);
    throw e;
  } finally {
    await log.flush();
  }
}

/** The brand's alternative to a flagged render: the shot the brand agent proposed for it, rendered instead of planning a new one. */
type Alternative = { of: string; shot: ShotProposal };

async function runPipeline(log: RenderLog, renderId: string, brandUid: string, licenceId: string, brief: string, aspectRatio: Aspect, alternative?: Alternative): Promise<RenderResult> {
  const { licence, price, caps } = await log.step(
    "licence",
    () => preflight(brandUid, licenceId),
    ({ licence: l, price: p }) => ({
      status: "ok",
      detail: `Licence active for ${useLabel(l.use)}: ${l.renderCount} of ${l.maxRenders} renders used, ${p} credits per image, until ${new Date(l.end).toISOString().slice(0, 10)}.`,
    }),
  );
  log.setCreator(licence.creatorId);
  // The eval brand's renders are automated test runs: labelled for the creator, payout reversed, kept out of the creator's lists.
  const evalRun = (await judgeRegistryCached())?.evalBrandUid === brandUid;
  const agent = ai().brandAgent;
  const calls: { step: RenderStep; metrics: CallMetrics }[] = [];

  // meta: the brand agent turns the brief into the shot; the policy code decides, with one alternative.
  let shot: ShotProposal = { id: "brief", prompt: brief, aspect: aspectRatio, rationale: "the brand's brief" };
  if (alternative) {
    shot = alternative.shot;
    log.add({ step: "plan", status: "skipped", ms: 0, detail: `The brand asked for an alternative to a flagged image; the brand agent proposed this shot: ${alternative.shot.rationale}` });
  } else if (aiProvider() === "meta") shot = await planShot(log, agent, brief, aspectRatio, licence, calls);

  const firstFilter = await policyStep(log, shot.prompt, licence, 1);
  if (firstFilter.metrics) calls.push({ step: "policy", metrics: firstFilter.metrics });

  // The creator's reference photos are opened only once the policy check has passed: a refused brief
  // never decrypts them and leaves no entry in the creator's access log.
  const { creator, refs, refEmbeddings } = await log.step(
    "frames",
    async () => {
      const creator = await getCreator(licence.creatorId);
      if (!creator) throw new RenderRefused(404, "creator not found", undefined, "NO_CREATOR");
      // The creator sees why their photos were opened: development and evaluation renders say so; real renders carry no label.
      const label = aiProvider() === "fixture" ? "Test render (development)" : evalRun ? EVAL_ACCESS_LABEL : undefined;
      const refs = await openFrames(creator, { licenceId, renderId, by: "render-service", ...(label ? { label } : {}) });
      // The consent gate needs the creator's face; without it, refuse before paying for a generation.
      const refEmbeddings = await referenceEmbeddings(refs).catch((e) => {
        refs.forEach((r) => r.fill(0));
        throw new RenderRefused(503, `render refused: the consent gate can't run (GATE_ERROR): ${(e as Error).message}`, undefined, "GATE_ERROR");
      });
      if (!refEmbeddings.length) {
        refs.forEach((r) => r.fill(0));
        throw new RenderRefused(503, "render refused: the consent gate found no usable reference face for this creator (GATE_ERROR)", undefined, "GATE_ERROR");
      }
      return { creator, refs, refEmbeddings };
    },
    ({ refs }) => ({ status: "ok", detail: `Opened the creator's ${refs.length} encrypted reference photos for this render (the opening is logged); prepared the face for the consent check.` }),
  );

  let final: Attempt;
  try {
    const ctx = { log, refs, refEmbeddings, licence, licenceId, aspectRatio, calls };
    const first = await attemptRender(ctx, shot, 1);
    const blockedBase = (a: Attempt) => ({
      id: renderId,
      licenceId,
      brandId: brandUid,
      creatorId: licence.creatorId,
      brief,
      model: a.out.metrics.model,
      charged: 0 as const,
      consent: consentRecord(a.consent),
      ...(evalRun ? { evalRun: true as const } : {}),
    });
    if (!first.consent.passed) {
      await recordBlocked({ ...blockedBase(first), createdAt: Date.now(), blockedBy: "consent", cost: renderCost(calls) });
      throw new RenderRefused(422, blockedSentence("consent", first.consent.explanation), undefined, first.consent.code ?? "GATE_ERROR");
    }
    final = first;
    // A reviewer's block: one automatic alternative shot, checked by the policy code and the policy check and
    // rendered once more; delivered if it passes the gate and isn't blocked again (a flag goes with its warning).
    // A reviewer's flag is delivered with its warning; the brand may ask for one alternative (renderAlternative).
    if (first.review.verdict === "block") {
      const second = await blockedRetry(ctx, agent, first);
      if (!second) {
        await recordBlocked({ ...blockedBase(first), createdAt: Date.now(), blockedBy: "review", review: reviewRecord(first.review), cost: renderCost(calls) });
        throw new RenderRefused(422, blockedSentence("review", first.review.reasons.join(" ")), undefined, "REVIEW_BLOCKED");
      }
      final = second;
    }
  } finally {
    refs.forEach((r) => r.fill(0));
    refEmbeddings.forEach((x) => x.fill(0));
  }

  const out = final.out;
  const cost = renderCost(calls);
  const labelled = await log.step(
    "label",
    () => labelRender(out.bytes),
    () => ({ status: "ok", detail: 'Visible "AI-generated · licensed likeness" label added, clear of the face.' }),
  );
  const signed = await log.step(
    "credential",
    async () =>
      embedManifest(new Uint8Array(labelled), "image/jpeg", {
        protocol: "likeness-ai/1",
        licenceId,
        renderIndex: licence.renderCount,
        renderType: "image",
        creator: { id: creator.uid, name: creator.displayName, youtubeChannelId: creator.channel?.channelId ?? null },
        licensee: { id: licence.brandId, name: licence.brandName },
        use: licence.use,
        receipt: {
          issuer: "Assent",
          store: "Firestore receipts/{sha256}",
          key: "sha256 of this file, manifest included",
          signedBy: "Cloud KMS EC_SIGN_P256_SHA256",
          verify: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/verify`,
        },
        renderer: { provider: out.metrics.provider === "meta" ? "Meta Model API" : out.metrics.provider === "fixture" ? "fixture (development, no model)" : "Vertex AI", model: out.metrics.model },
        promptSha256: createHash("sha256").update(final.shot.prompt).digest("hex"),
        createdAt: new Date().toISOString(),
      }),
    () => ({ status: "ok", detail: "C2PA content credential embedded: the licence, the creator, the brand and where the receipt is." }),
  );
  const { render, receipt } = await log.step(
    "payment",
    async () => {
      const previewObject = `renders/preview/${renderId}.jpg`;
      await putObject(previewObject, await sharp(labelled).resize({ width: 480, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer(), "image/jpeg");
      return payOrBlock(
        {
          brandUid,
          licence,
          bytes: signed,
          mime: "image/jpeg",
          model: out.metrics.model,
          brief,
          renderId,
          previewObject,
          aspect: aspectRatio,
          consent: consentRecord(final.consent),
          cost,
          review: reviewRecord(final.review),
          caps,
          evalRun,
          ...(alternative ? { alternativeOf: alternative.of } : {}),
          ...(final.shot.prompt !== brief ? { prompt: final.shot.prompt } : {}),
        },
        {
          id: renderId,
          licenceId,
          brandId: brandUid,
          creatorId: licence.creatorId,
          brief,
          model: out.metrics.model,
          charged: 0,
          consent: consentRecord(final.consent),
          review: reviewRecord(final.review),
          cost,
          ...(evalRun ? { evalRun: true as const } : {}),
        },
      );
    },
    ({ render: r }) => ({ status: "ok", detail: `Receipt signed (Cloud KMS); ${r.price} credits paid, ${r.creatorShare} to the creator after the ${r.fee}-credit fee. Delivered.` }),
  );
  log.finish("delivered", `Delivered: ${price} credits paid${final.review.verdict === "flag" ? "; flagged by the reviewer" : ""}${final.attempt === 2 ? " (the alternative shot)" : ""}.`);
  const { metrics: _m, ...publicFilter } = final.filter;
  void _m;
  return { renderId, render: publicRender(render), receipt: { keyVersion: receipt.keyVersion, alg: receipt.alg }, filter: publicFilter };
}

type Attempt = { attempt: 1 | 2; shot: ShotProposal; filter: FilterResult; out: GeneratedImage; consent: ConsentResult; review: ReviewResult };
type AttemptCtx = {
  log: RenderLog;
  refs: Uint8Array[];
  refEmbeddings: Float32Array[];
  licence: LicenceDoc;
  licenceId: string;
  aspectRatio: Aspect;
  calls: { step: RenderStep; metrics: CallMetrics }[];
};

/** The policy check (keyword rules, then the model) on the prompt about to be rendered. */
async function policyStep(log: RenderLog, prompt: string, licence: LicenceDoc, attempt: 1 | 2): Promise<FilterResult> {
  return log.step(
    "policy",
    async () => {
      const f = await checkPrompt(prompt, licence);
      if (!f.allowed) throw new RenderRefused(422, `render refused by the safety filter: ${f.reasons.join("; ")}`, f, filterCode(f));
      return f;
    },
    (f) => ({
      status: "ok",
      detail: `Passed: ${f.layers
        .filter((l) => l.ran)
        .map((l) => l.name)
        .join(", ")}.`,
      ...fromMetrics(f.metrics),
      ...(attempt === 2 ? { attempt } : {}),
    }),
    attempt,
  );
}

/** meta: plan the shot from the brief; one alternative if the policy code refuses it. Each attempt is logged. */
/** Whether a plan's metrics are from a real model call: the "no call" placeholder has no latency and no cost (a fast call can take under 1 ms in tests). */
const madeCall = (m: CallMetrics) => m.latencyMs > 0 || m.cost !== null;

async function planShot(log: RenderLog, agent: BrandAgent, brief: string, aspect: Aspect, licence: LicenceDoc, calls: AttemptCtx["calls"]): Promise<ShotProposal> {
  const t = Date.now();
  const plan = await planWithAlternatives(agent, { text: brief, idea: "", product: "", setting: "", mood: "warm", aspect, shots: 1 }, licence, ruleCheck).catch((e) => {
    if (isBudgetStop(e)) throw e;
    log.add({ step: "plan", status: "error", ms: Date.now() - t, detail: `The brand agent could not plan the shot: ${(e as Error).message}` });
    throw new RenderRefused(503, `render refused: the brand agent could not plan the shot (${(e as Error).message})`, undefined, "POLICY_CHECK_FAILED");
  });
  for (const m of [plan.metrics, ...plan.extraMetrics]) if (madeCall(m)) calls.push({ step: "plan", metrics: m });
  const ms = Date.now() - t;
  if (!plan.attempts.length) {
    // The model refused before proposing a shot: the step still carries the call's model, settings and cost.
    const d = plan.decisions[0];
    const costUsd = [plan.metrics, ...plan.extraMetrics].reduce((s, m) => s + (m.cost?.costUsd ?? 0), 0);
    log.add({ step: "plan", status: "refused", ms, detail: d?.explanation ?? "No shot was planned.", ...(d?.code ? { code: d.code } : {}), ...(madeCall(plan.metrics) ? { ...fromMetrics(plan.metrics), costUsd } : {}) });
  }
  plan.attempts.forEach((a, i) =>
    log.add({
      step: "plan",
      status: a.allowed ? "ok" : "refused",
      ms: i === 0 ? plan.metrics.latencyMs : (plan.extraMetrics[i - 1]?.latencyMs ?? 0),
      detail: a.explanation,
      ...(a.code ? { code: a.code } : {}),
      ...(a.attempt === 2 ? { attempt: 2 } : {}),
      ...fromMetrics(i === 0 ? plan.metrics : plan.extraMetrics[i - 1]),
    }),
  );
  const ok = plan.decisions.find((d) => d.allowed && d.shotId);
  const shot = ok && plan.shots.find((s) => s.id === ok.shotId);
  if (!shot) {
    const last = plan.decisions[plan.decisions.length - 1];
    throw new RenderRefused(422, `render refused: ${last?.explanation ?? "no shot could be planned"}`, undefined, last?.code ?? "MODEL_REFUSED");
  }
  return shot;
}

/** Generate, run the consent gate, and review: one attempt at an image, logged and costed. */
async function attemptRender(ctx: AttemptCtx, shot: ShotProposal, attempt: 1 | 2, filter?: FilterResult): Promise<Attempt> {
  const { log, licence } = ctx;
  const tag = attempt === 2 ? { attempt: 2 as const } : {};
  const out = await log.step(
    "generate",
    () =>
      ai().imageGenerator.edit(
        ctx.refs.map((bytes) => ({ bytes, mime: "image/jpeg" as const })),
        shot.prompt,
        { aspectRatio: ctx.aspectRatio, quality: "full", licenceId: ctx.licenceId, renderIndex: licence.renderCount },
      ),
    (o) => ({
      status: "ok",
      detail: `Image generated by ${o.metrics.model} in ${(o.metrics.latencyMs / 1000).toFixed(1)} s${o.metrics.settings?.reasoning_strength ? ` (reasoning strength ${o.metrics.settings.reasoning_strength})` : ""}.`,
      ...fromMetrics(o.metrics),
      ...tag,
    }),
    attempt,
  );
  ctx.calls.push({ step: "generate", metrics: out.metrics });

  const t = Date.now();
  const consent = await runConsentGate({ bytes: out.bytes, mime: out.mime }, ctx.refEmbeddings, ai().segmenter, licence.creatorName);
  ctx.calls.push(...consent.metrics.map((metrics) => ({ step: "consent" as const, metrics })));
  log.add({
    step: "consent",
    status: consent.passed ? "ok" : "blocked",
    ms: Date.now() - t,
    // Short on the step line; the full reason and what to do are in the brand's error card.
    detail: consent.short,
    ...(consent.code ? { code: consent.code } : {}),
    ...fromMetrics(consent.metrics[0]),
    costUsd: consent.metrics.reduce((s, m) => s + (m.cost?.costUsd ?? 0), 0),
    ...(consent.figure ? { figure: consent.figure } : {}),
    ...tag,
  });
  const noReview: ReviewResult = { verdict: "pass", findings: [], reasons: [], skipped: true, metrics: null };
  if (!consent.passed) return { attempt, shot, filter: filter ?? ({} as FilterResult), out, consent, review: noReview };

  const tr = Date.now();
  let review: ReviewResult;
  try {
    review = await ai().reviewer.review({ bytes: out.bytes, mime: out.mime }, shot, licence);
  } catch (e) {
    if (isBudgetStop(e)) throw e;
    const message = `The output review could not run, so the image was not delivered: ${(e as Error).message.slice(0, 200)}`;
    log.add({ step: "review", status: "blocked", code: "REVIEW_ERROR", ms: Date.now() - tr, detail: message, ...tag });
    review = { verdict: "block", findings: [], reasons: [message], metrics: null };
    return { attempt, shot, filter: filter ?? ({} as FilterResult), out, consent, review };
  }
  if (review.metrics) ctx.calls.push({ step: "review", metrics: review.metrics });
  log.add({
    step: "review",
    status: review.skipped ? "skipped" : review.verdict === "pass" ? "ok" : review.verdict === "flag" ? "flagged" : "blocked",
    ms: Date.now() - tr,
    detail: review.reasons.join(" ") || "Matches the brief and the licence.",
    ...(review.verdict === "block" ? { code: "REVIEW_BLOCKED" } : review.verdict === "flag" ? { code: "REVIEW_FLAG" } : {}),
    ...fromMetrics(review.metrics),
    ...tag,
  });
  return { attempt, shot, filter: filter ?? ({} as FilterResult), out, consent, review };
}

/** One automatic alternative after a reviewer's block. Returns the second attempt when it is deliverable, else null (the image stays blocked). */
async function blockedRetry(ctx: AttemptCtx, agent: BrandAgent, first: Attempt): Promise<Attempt | null> {
  const { log, licence } = ctx;
  const t = Date.now();
  const alt = await proposeAlternative(agent, first.shot, { code: "REVIEW_BLOCKED", explanation: first.review.reasons.join(" ") }, licence, ruleCheck);
  if (!alt) return null;
  if (alt.metrics) ctx.calls.push({ step: "alternative", metrics: alt.metrics });
  log.add({
    step: "alternative",
    status: alt.decision.allowed ? "ok" : "refused",
    attempt: 2,
    ms: Date.now() - t,
    detail: alt.decision.allowed ? `Alternative shot proposed for the block: ${alt.shot!.rationale}` : `${alt.decision.explanation} The image stays blocked.`,
    ...(alt.decision.code ? { code: alt.decision.code } : {}),
    ...fromMetrics(alt.metrics),
  });
  if (!alt.decision.allowed || !alt.shot) return null;
  let filter: FilterResult;
  try {
    filter = await policyStep(log, alt.shot.prompt, licence, 2);
  } catch (e) {
    if (isBudgetStop(e)) throw e;
    return null; // the second refusal is final: the image stays blocked
  }
  if (filter.metrics) ctx.calls.push({ step: "policy", metrics: filter.metrics });
  const second = await attemptRender(ctx, alt.shot, 2, filter).catch((e) => {
    if (isBudgetStop(e)) throw e;
    return null;
  });
  if (!second || !second.consent.passed || second.review.verdict === "block") return null;
  return second;
}
