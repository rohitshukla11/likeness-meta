import "server-only";
/**
 * BrandAgent and OutputReviewer on Meta Muse Spark (muse-spark-1.3) over the Responses API,
 * POST /v1/responses, with structured output: text.format = { type: "json_schema", name, schema,
 * strict: true } (https://dev.meta.ai/docs/structured-output and the Responses API reference).
 *
 *  - store: false and stream: false on every call; images (the reviewer's) only as base64 data URLs.
 *  - Every answer is parsed and validated against its schema here (lib/server/ai/jsonSchema.ts), on
 *    top of Meta's constrained decoding. Invalid JSON, a schema miss or a model refusal throws a
 *    SparkError with a reason code; callers refuse (fail closed): the filter refuses the render, the
 *    pipeline blocks the image, planning returns a refusal.
 *  - The model only proposes. Shots go through lib/server/ai/policy.ts decideShots; the reviewer's
 *    answer becomes findings and the code decides the verdict (reviewVerdict).
 *  - The creator's name is never sent, and is replaced if the model writes it anyway.
 * Price: $1.25 / $0.15 cached / $4.25 per 1M input / cached / output tokens; reasoning tokens are
 * counted within output_tokens (Responses API reference). lib/server/ai/pricing.ts.
 */
import { CATEGORIES } from "@/lib/categories";
import { FRAMING_RULES, type PromptDetails } from "@/lib/creative";
import { useLabel, type LicenceDoc } from "@/lib/model";
import { withoutName } from "../../assistant";
import { ruleCheck } from "../../rules";
import { assertSupported, validate, type Schema } from "../jsonSchema";
import { decideShots, explain, licenceRefusal, reviewVerdict } from "../policy";
import { estimateCost } from "../pricing";
import { BANNED_KEYS, FILTER_INSTRUCTION } from "../prompts";
import type { AlternativeReason, BrandAgent, BrandBrief, CallMetrics, ImageInput, ModelPolicyVerdict, OutputReviewer, ReviewFinding, ShotPlan, ShotProposal } from "../types";
import { metaConfigured, metaPost } from "./client";

export type SparkCode = "INVALID_MODEL_OUTPUT" | "MODEL_REFUSED" | "NO_MODEL_OUTPUT";

export class SparkError extends Error {
  constructor(
    readonly code: SparkCode,
    message: string,
    readonly metrics?: CallMetrics,
  ) {
    super(`${code}: ${message}`);
  }
}

const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export function sparkConfig() {
  const effort = process.env.MUSE_SPARK_REASONING_EFFORT?.trim();
  if (effort && !EFFORTS.includes(effort as never)) throw new Error(`MUSE_SPARK_REASONING_EFFORT must be one of ${EFFORTS.join(", ")}`);
  const max = Number(process.env.MUSE_SPARK_MAX_OUTPUT_TOKENS ?? 4096);
  if (!Number.isInteger(max) || max < 16) throw new Error("MUSE_SPARK_MAX_OUTPUT_TOKENS must be a whole number of at least 16");
  return { model: process.env.MUSE_SPARK_MODEL || "muse-spark-1.3", maxOutputTokens: max, effort: (effort || null) as (typeof EFFORTS)[number] | null };
}

type ContentPart = { type: "input_text"; text: string } | { type: "input_image"; image_url: string };

/** The request body for one structured answer. Pure: the tests check it without calling Meta. */
export function sparkRequest(task: { name: string; instructions: string; content: ContentPart[]; schema: Schema; temperature: number }, cfg = sparkConfig()) {
  assertSupported(task.schema);
  return {
    model: cfg.model,
    instructions: task.instructions,
    input: [{ type: "message", role: "user", content: task.content }],
    text: { format: { type: "json_schema", name: task.name, schema: task.schema, strict: true } },
    store: false,
    stream: false,
    temperature: task.temperature,
    max_output_tokens: cfg.maxOutputTokens,
    ...(cfg.effort ? { reasoning: { effort: cfg.effort } } : {}),
  };
}

type SparkResponse = {
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[];
  usage?: Record<string, unknown>;
};

/** Parse and validate the answer; any problem is a SparkError (the caller refuses). */
export function sparkAnswer<T>(res: SparkResponse, schema: Schema, metrics: CallMetrics): T {
  const parts = (res.output ?? []).filter((o) => o.type === "message").flatMap((o) => o.content ?? []);
  const refusal = parts.find((p) => p.type === "refusal");
  if (refusal) throw new SparkError("MODEL_REFUSED", `the model refused: ${String(refusal.refusal ?? "").slice(0, 300)}`, metrics);
  const text = parts.filter((p) => p.type === "output_text").map((p) => p.text ?? "").join("");
  if (!text.trim()) throw new SparkError("NO_MODEL_OUTPUT", `the model returned no answer${res.status ? ` (status ${res.status}${res.incomplete_details?.reason ? `, ${res.incomplete_details.reason}` : ""})` : ""}`, metrics);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SparkError("INVALID_MODEL_OUTPUT", "the model's answer is not valid JSON", metrics);
  }
  const errs = validate(parsed, schema);
  if (errs.length) throw new SparkError("INVALID_MODEL_OUTPUT", `the model's answer doesn't match the schema: ${errs.slice(0, 3).join("; ")}`, metrics);
  return parsed as T;
}

async function ask<T>(task: Parameters<typeof sparkRequest>[0]): Promise<{ answer: T; metrics: CallMetrics }> {
  const cfg = sparkConfig();
  const t = Date.now();
  const res = await metaPost<SparkResponse>("/responses", sparkRequest(task, cfg), { timeoutMs: 60_000 });
  const model = res.model ?? cfg.model;
  const metrics: CallMetrics = { provider: "meta", model, latencyMs: Date.now() - t, usage: res.usage, cost: estimateCost("meta", cfg.model, res.usage), ...(cfg.effort ? { settings: { reasoning_effort: cfg.effort } } : {}) };
  return { answer: sparkAnswer<T>(res, task.schema, metrics), metrics };
}

const text = (s: string) => ({ type: "input_text" as const, text: s });
const categoryLabel = (l: LicenceDoc) => CATEGORIES.find((c) => c.key === l.use)?.label ?? "unknown";

// ---------------------------------------------------------------- policy check (the filter's model layer)

export const POLICY_SCHEMA: Schema = {
  type: "object",
  additionalProperties: false,
  required: ["banned", "fitsCategory", "reason"],
  properties: {
    banned: { type: "array", maxItems: BANNED_KEYS.length, items: { type: "string", enum: BANNED_KEYS } },
    fitsCategory: { type: "boolean" },
    reason: { type: "string", maxLength: 600 },
  },
};

async function checkPolicy(prompt: string, licence: LicenceDoc): Promise<ModelPolicyVerdict> {
  const { answer, metrics } = await ask<{ banned: string[]; fitsCategory: boolean; reason: string }>({
    name: "policy_check",
    instructions: FILTER_INSTRUCTION,
    content: [text(`Licence category: ${categoryLabel(licence)}\nPrompt: ${prompt}`)],
    schema: POLICY_SCHEMA,
    temperature: 0,
  });
  return { ...answer, metrics };
}

// ---------------------------------------------------------------- shot planning

const MAX_SHOTS = 4;

const detailFields = { subject: 400, action: 400, setting: 400, wardrobe: 200, composition: 400, style: 200 } as const;
export const PLAN_SCHEMA: Schema = {
  type: "object",
  additionalProperties: false,
  required: ["refused", "refusalReason", "shots"],
  properties: {
    refused: { type: "boolean" },
    refusalReason: { type: "string", maxLength: 400 },
    shots: {
      type: "array",
      maxItems: MAX_SHOTS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["prompt", "rationale", ...Object.keys(detailFields)],
        properties: {
          prompt: { type: "string", minLength: 3, maxLength: 1200 },
          rationale: { type: "string", maxLength: 300 },
          ...Object.fromEntries(Object.entries(detailFields).map(([k, n]) => [k, { type: "string", maxLength: n } as Schema])),
        },
      },
    },
  },
};

const PLAN_INSTRUCTION = (useLabel: string, n: number) => `You plan shots for an AI ad generator that renders a real, consenting adult under a likeness licence.
The licence allows exactly one use: ${useLabel}. Plan only shots for that use; if the brief needs another use, set refused to true and explain in refusalReason.
Never plan, under any licence (set refused to true instead): political content; adult, sexual or revealing content; anything involving minors or a childlike depiction; impersonation (presenting the person as someone else); deception (fake news, fake evidence, fake reviews or testimonials, staged real events); claims, quotes or endorsements attributed to the person.
Refer to the person only as "the person". Never use or invent a name, job, age, nationality or biography. The product appears in the ad; the person is shown with it, nothing more is claimed. Exactly one person in every shot.
Plan up to ${n} distinct shot(s). For each: prompt = the complete image prompt as one paragraph (at most 900 characters), starting with the subject; rationale = one line on why this shot serves the brief; and the details: subject, action, setting, wardrobe, composition, style.
Framing for every shot (the server also appends these rules to every render): ${FRAMING_RULES}
Your answer is a proposal: the licence rules are applied by code afterwards. Return JSON matching the schema.`;

const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

type PlanAnswer = { refused: boolean; refusalReason: string; shots: ({ prompt: string; rationale: string } & PromptDetails)[] };

async function planShots(brief: BrandBrief, licence: LicenceDoc): Promise<ShotPlan> {
  const noCall: CallMetrics = { provider: "meta", model: sparkConfig().model, latencyMs: 0, cost: null };
  // The code decides first: a licence that can't render, or banned words in the brief, never reach the model.
  const whole = licenceRefusal(licence);
  if (whole) return { shots: [], decisions: [whole], metrics: noCall };
  const asked = [brief.text, brief.idea, brief.product, brief.setting].filter(Boolean).join(" · ");
  const hits = ruleCheck(asked);
  if (hits.length) return { shots: [], decisions: [{ shotId: null, allowed: false, code: "BANNED_USE", explanation: explain("BANNED_USE", `Matched: ${hits.join("; ")}.`) }], metrics: noCall };

  const n = Math.min(MAX_SHOTS, Math.max(1, Math.floor(brief.shots ?? 1)), licence.maxRenders - licence.renderCount);
  const ask_ = [
    `Brief: ${clip(brief.text, 600) || "(none)"}`,
    `Idea: ${clip(brief.idea, 120) || "(none: a simple product ad)"}`,
    `Product: ${clip(brief.product, 80) || "(unspecified: a generic product)"}`,
    `Setting: ${clip(brief.setting, 100) || "(choose one that suits the idea)"}`,
    `Mood: ${brief.mood}`,
    `Aspect: ${brief.aspect}`,
    `Shots wanted: ${n}`,
  ].join("\n");
  let answer: PlanAnswer;
  let metrics: CallMetrics;
  try {
    ({ answer, metrics } = await ask<PlanAnswer>({ name: "shot_plan", instructions: PLAN_INSTRUCTION(useLabel(licence.use), n), content: [text(ask_)], schema: PLAN_SCHEMA, temperature: 0.7 }));
  } catch (e) {
    if (!(e instanceof SparkError)) throw e;
    const code = e.code === "MODEL_REFUSED" ? "MODEL_REFUSED" : "POLICY_CHECK_FAILED";
    return { shots: [], decisions: [{ shotId: null, allowed: false, code, explanation: explain(code, e.message) }], metrics: e.metrics ?? noCall };
  }
  if (answer.refused) return { shots: [], decisions: [{ shotId: null, allowed: false, code: "MODEL_REFUSED", explanation: explain("MODEL_REFUSED", clip(answer.refusalReason, 400) || "Outside this licence's allowed use.") }], metrics };
  const clean = (s: string) => withoutName(s, licence.creatorName);
  const shots: ShotProposal[] = answer.shots.slice(0, n).map((s, i) => ({
    id: `shot-${i + 1}`,
    prompt: clean(s.prompt),
    aspect: brief.aspect,
    rationale: clean(s.rationale),
    details: Object.fromEntries(Object.keys(detailFields).map((k) => [k, clean(s[k as keyof PromptDetails])])) as PromptDetails,
  }));
  return { shots, decisions: decideShots(shots, licence, ruleCheck), metrics };
}

// ---------------------------------------------------------------- one alternative to a refused or flagged shot

const shotItem = (PLAN_SCHEMA.properties!.shots as Schema).items!;
export const REVISE_SCHEMA: Schema = {
  type: "object",
  additionalProperties: false,
  required: ["refused", "refusalReason", "shot"],
  properties: { refused: { type: "boolean" }, refusalReason: { type: "string", maxLength: 400 }, shot: shotItem },
};

const REVISE_INSTRUCTION = (useLabel: string) => `${PLAN_INSTRUCTION(useLabel, 1)}
One earlier shot was refused or flagged, for the reason given. Propose exactly one alternative that keeps the brief's intent and fixes that reason. If no compliant alternative exists, set refused to true and explain.`;

type ReviseAnswer = { refused: boolean; refusalReason: string; shot: { prompt: string; rationale: string } & PromptDetails };

async function reviseShot(shot: ShotProposal, reason: AlternativeReason, licence: LicenceDoc): Promise<{ shot: ShotProposal | null; note: string; metrics: CallMetrics }> {
  const clean = (s: string) => withoutName(s, licence.creatorName);
  const content = [text(`Earlier shot: ${clean(shot.prompt)}\nReason (${reason.code}): ${clean(reason.explanation)}\nAspect: ${shot.aspect}`)];
  try {
    const { answer, metrics } = await ask<ReviseAnswer>({ name: "shot_alternative", instructions: REVISE_INSTRUCTION(useLabel(licence.use)), content, schema: REVISE_SCHEMA, temperature: 0.7 });
    if (answer.refused) return { shot: null, note: clip(answer.refusalReason, 400) || "no compliant alternative", metrics };
    const a = answer.shot;
    return {
      shot: { id: shot.id, prompt: clean(a.prompt), aspect: shot.aspect, rationale: clean(a.rationale), details: Object.fromEntries(Object.keys(detailFields).map((k) => [k, clean(a[k as keyof PromptDetails])])) as PromptDetails },
      note: clean(a.rationale),
      metrics,
    };
  } catch (e) {
    if (!(e instanceof SparkError)) throw e;
    return { shot: null, note: e.message, metrics: e.metrics ?? { provider: "meta", model: sparkConfig().model, latencyMs: 0, cost: null } };
  }
}

export const sparkBrandAgent: BrandAgent = {
  label: "Muse Spark",
  configHint: "MODEL_API_KEY",
  policyConfigured: metaConfigured,
  planShots,
  checkPolicy,
  reviseShot,
};

// ---------------------------------------------------------------- output review

export const REVIEW_SCHEMA: Schema = {
  type: "object",
  additionalProperties: false,
  required: ["productMatches", "settingMatches", "fitsLicensedUse", "bannedContent", "notes"],
  properties: {
    productMatches: { type: "boolean", description: "the product the shot asks for is visible and is that product" },
    settingMatches: { type: "boolean", description: "the setting and scene match the shot" },
    fitsLicensedUse: { type: "boolean", description: "the image fits the licence's one allowed use" },
    bannedContent: { type: "array", maxItems: BANNED_KEYS.length, items: { type: "string", enum: BANNED_KEYS } },
    notes: { type: "string", maxLength: 600, description: "one or two plain sentences on what differs, or what was checked" },
  },
};

const REVIEW_INSTRUCTION = `You review a finished ad image made under a likeness licence, before it is delivered to the brand.
Compare the image with the shot it was made from and with the licence. Answer only from what is visible in the image.
- productMatches: the product the shot asks for is visible and is that product (true if the shot names no product).
- settingMatches: the setting and scene match the shot.
- fitsLicensedUse: the image fits the licence's one allowed use.
- bannedContent: any banned use the image shows: political, adult (sexual or revealing), minors (anyone childlike), impersonation (the person presented as someone else or as endorsing something), deception (fake evidence, fake news, staged real events). Empty if none.
- notes: one or two plain sentences.
Your answer is a proposal: the code decides what happens. Return JSON matching the schema.`;

type ReviewAnswer = { productMatches: boolean; settingMatches: boolean; fitsLicensedUse: boolean; bannedContent: string[]; notes: string };

/** The reviewer's answer as findings: banned content or a use outside the licence is a licence finding; product or setting a brief finding. */
export function reviewFindings(a: ReviewAnswer, licence: LicenceDoc): ReviewFinding[] {
  const f: ReviewFinding[] = [];
  for (const b of a.bannedContent) f.push({ kind: "licence", text: `The image shows a banned use (${b}).` });
  if (!a.fitsLicensedUse) f.push({ kind: "licence", text: `The image doesn't fit the licensed use (${useLabel(licence.use)}).` });
  if (!a.productMatches) f.push({ kind: "brief", text: "The product isn't the one in the shot." });
  if (!a.settingMatches) f.push({ kind: "brief", text: "The setting differs from the shot." });
  return f;
}

const dataUrl = (img: ImageInput) => `data:${img.mime};base64,${Buffer.from(img.bytes).toString("base64")}`;

export const sparkReviewer: OutputReviewer = {
  async review(image, shot, licence) {
    const { answer, metrics } = await ask<ReviewAnswer>({
      name: "output_review",
      instructions: REVIEW_INSTRUCTION,
      content: [text(`Licence use: ${useLabel(licence.use)}\nShot: ${shot.prompt}`), { type: "input_image", image_url: dataUrl(image) }],
      schema: REVIEW_SCHEMA,
      temperature: 0,
    });
    const findings = reviewFindings(answer, licence);
    const verdict = reviewVerdict(findings);
    const notes = clip(withoutName(answer.notes, licence.creatorName), 600);
    return { verdict, findings, reasons: findings.length ? [...findings.map((x) => x.text), ...(notes ? [notes] : [])] : [notes || "Matches the shot and the licence."], metrics };
  },
};
