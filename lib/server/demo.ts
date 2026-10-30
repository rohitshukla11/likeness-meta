import "server-only";
/**
 * Judge mode. scripts/seed-judges.ts seeds a judge brand and a judge creator (the synthetic demo
 * creator under a likeness-meta-only uid), a judge licence through the normal request flow, and a
 * separate eval brand and licence, and records them in demo/judges.
 *
 * "Reset demo" (judge accounts only) restores the judge licence: render count back to 0, active again
 * if it was revoked, and no earlier end than seeded; and the judge brand's demo credits, with a ledger
 * entry. It never touches the eval licence, other accounts, or the daily limits (which keep a judge's
 * repeated resets from running up model costs).
 */
import { FieldValue } from "firebase-admin/firestore";
import type { DailyCaps, LicenceDoc } from "@/lib/model";
import { firestore } from "./firebase-admin";
import { accessToken, requireProject } from "./gcp";
import { HttpError } from "./http";

export type JudgeRegistry = {
  brandUid: string;
  creatorUid: string;
  /** The creator copied from likeness-ai (demo-maya-okafor), re-keyed to creatorUid and unlisted. */
  sourceCreatorUid: string;
  licenceId: string;
  /** The seeded end of the judge licence; a reset never shortens it. */
  licenceEnd: number;
  /** The judge brand's demo credits after seeding, restored by a reset. */
  brandCredits: number;
  evalBrandUid: string;
  evalLicenceId: string;
  seededAt: number;
};

const registryRef = () => firestore().collection("demo").doc("judges");

export async function judgeRegistry(): Promise<JudgeRegistry | null> {
  const s = await registryRef().get();
  return s.exists ? (s.data() as JudgeRegistry) : null;
}

export const isJudge = (r: JudgeRegistry | null, uid: string) => !!r && (uid === r.brandUid || uid === r.creatorUid);

/** The judge brand's own daily render limit (judges try the full flow many times); every other brand keeps the usual one. */
export const judgeBrandRendersPerDay = () => Number(process.env.JUDGE_BRAND_RENDERS_PER_DAY ?? 25);

/** The eval brand's daily render limit (scripts/eval.ts runs the whole eval set in one go). */
export const evalBrandRendersPerDay = () => Number(process.env.EVAL_BRAND_RENDERS_PER_DAY ?? 20);

/** Daily caps for one brand. Pure: the judge brand and the eval brand get their own limits; every other brand the usual one; the site-wide cap still applies. */
export function dailyCapsFor(brandUid: string, r: Pick<JudgeRegistry, "brandUid" | "evalBrandUid"> | null, base: DailyCaps): DailyCaps {
  if (r && brandUid === r.brandUid) return { ...base, brandRenders: judgeBrandRendersPerDay() };
  if (r && brandUid === r.evalBrandUid) return { ...base, brandRenders: evalBrandRendersPerDay() };
  return base;
}

let cached: { at: number; r: JudgeRegistry | null } | null = null;
/** The registry, cached for a minute (read on every render for the caps). */
export async function judgeRegistryCached(): Promise<JudgeRegistry | null> {
  if (!cached || Date.now() - cached.at > 60_000) cached = { at: Date.now(), r: await judgeRegistry() };
  return cached.r;
}

/** What a reset changes on the judge licence. Pure. */
export function licenceResetPatch(l: Pick<LicenceDoc, "end" | "revokedAt" | "renderCount">, r: Pick<JudgeRegistry, "licenceEnd">) {
  return { renderCount: 0, end: Math.max(l.end, r.licenceEnd), revoked: l.revokedAt !== undefined };
}

export async function resetDemo(callerUid: string): Promise<{ licenceId: string; renderCount: 0; credits: number; wasRevoked: boolean }> {
  const r = await judgeRegistry();
  if (!r) throw new HttpError(404, "judge mode isn't set up on this server");
  if (!isJudge(r, callerUid)) throw new HttpError(403, "only the judge accounts can reset the demo", "NOT_JUDGE");
  const db = firestore();
  return db.runTransaction(async (tx) => {
    const lref = db.collection("licences").doc(r.licenceId);
    const cref = db.collection("credits").doc(r.brandUid);
    const [ls, cs] = await Promise.all([tx.get(lref), tx.get(cref)]);
    if (!ls.exists) throw new HttpError(404, "the judge licence is missing; run the seed script again");
    const l = ls.data() as LicenceDoc;
    const p = licenceResetPatch(l, r);
    tx.update(lref, { renderCount: p.renderCount, end: p.end, revokedAt: FieldValue.delete() });
    const before = Number(cs.data()?.balance ?? 0);
    tx.set(cref, { uid: r.brandUid, balance: r.brandCredits, updatedAt: Date.now() }, { merge: true });
    tx.create(db.collection("ledger").doc(), { uid: r.brandUid, delta: r.brandCredits - before, reason: "demo reset (judge mode)", licenceId: r.licenceId, at: Date.now(), by: callerUid });
    return { licenceId: r.licenceId, renderCount: 0 as const, credits: r.brandCredits, wasRevoked: p.revoked };
  });
}

/**
 * Whether Firebase Authentication allows email/password sign-in on this project, read from the
 * Identity Toolkit admin config (read-only). Throws with a plain message if it can't be read.
 */
export async function emailPasswordEnabled(): Promise<boolean> {
  const project = requireProject();
  const r = await fetch(`https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`, {
    headers: { Authorization: `Bearer ${await accessToken()}`, "x-goog-user-project": project },
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json().catch(() => ({}))) as { signIn?: { email?: { enabled?: boolean } }; error?: { message?: string } };
  if (!r.ok) throw new Error(`couldn't read the Firebase sign-in settings (HTTP ${r.status}: ${j.error?.message ?? "no message"})`);
  return j.signIn?.email?.enabled === true;
}

/** The eval licence and the eval brand's credits back as seeded (scripts/reset-eval.ts, scripts/eval.ts). Never the judge accounts. */
export async function resetEvalLicence(): Promise<{ renders: number; credits: number; restoredCredits: number }> {
  const r = await judgeRegistry();
  if (!r) throw new Error("judge mode isn't set up (run pnpm seed:judges)");
  const db = firestore();
  return db.runTransaction(async (tx) => {
    const lref = db.collection("licences").doc(r.evalLicenceId);
    const cref = db.collection("credits").doc(r.evalBrandUid);
    const [l, c] = await Promise.all([tx.get(lref), tx.get(cref)]);
    if (!l.exists) throw new Error(`eval licence ${r.evalLicenceId} is missing`);
    const before = { renders: Number(l.data()?.renderCount ?? 0), credits: Number(c.data()?.balance ?? 0) };
    tx.update(lref, { renderCount: 0, revokedAt: FieldValue.delete() });
    tx.set(cref, { uid: r.evalBrandUid, balance: r.brandCredits, updatedAt: Date.now() }, { merge: true });
    if (before.credits !== r.brandCredits) tx.create(db.collection("ledger").doc(), { uid: r.evalBrandUid, delta: r.brandCredits - before.credits, reason: "eval reset", licenceId: r.evalLicenceId, at: Date.now() });
    return { ...before, restoredCredits: r.brandCredits };
  });
}

