import "server-only";
/**
 * Idempotent render requests. The browser sends a fresh requestId (a UUID) with each "Make an image ad";
 * the render id is derived from the brand and that id, so a retried or double-clicked request maps to
 * the same render. renderRequests/{renderId} records it:
 *   new        → claimed, the render runs;
 *   running    → refused with 409 (the first one is still going; its step log shows progress);
 *   done       → the stored result is returned, nothing generated or charged again;
 *   failed     → the same refusal is returned (a server error, 5xx, may be retried with the same id);
 *   same id with another licence, brief or aspect → refused.
 * A claim left running for 15 minutes (a crashed instance) may be taken over.
 * The settlement also creates the render document with create(), so one request id can never be
 * charged twice even if two claims raced.
 */
import { createHash } from "node:crypto";
import { firestore } from "./firebase-admin";
import { HttpError } from "./http";

export const STALE_MS = 15 * 60_000;

export type RenderRequestDoc = {
  brandId: string;
  fingerprint: string;
  state: "running" | "done" | "failed";
  createdAt: number;
  updatedAt: number;
  result?: unknown;
  error?: { status: number; message: string; code?: string };
};

export function renderIdFor(brandUid: string, requestId: string): string {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw new HttpError(400, "bad requestId: use 8 to 64 letters, digits, - or _ (a UUID works)");
  return createHash("sha256").update(`${brandUid}:${requestId}`).digest("base64url").slice(0, 22);
}

export const fingerprintOf = (input: { licenceId: string; brief: string; aspectRatio: string }) =>
  createHash("sha256").update(JSON.stringify([input.licenceId, input.brief, input.aspectRatio])).digest("hex");

export type ClaimDecision = { kind: "run" } | { kind: "replay"; result: unknown } | { kind: "refuse"; status: number; message: string; code?: string };

/** What to do with a request, given any earlier claim for the same render id. Pure. */
export function claimDecision(prior: RenderRequestDoc | undefined, brandUid: string, fingerprint: string, now = Date.now()): ClaimDecision {
  if (!prior) return { kind: "run" };
  if (prior.brandId !== brandUid || prior.fingerprint !== fingerprint) return { kind: "refuse", status: 409, message: "this requestId was already used for a different render; send a new one" };
  if (prior.state === "done") return { kind: "replay", result: prior.result };
  if (prior.state === "failed" && (prior.error?.status ?? 500) >= 500) return { kind: "run" };
  if (prior.state === "failed") return { kind: "refuse", status: prior.error?.status ?? 500, message: prior.error?.message ?? "the earlier attempt failed", ...(prior.error?.code ? { code: prior.error.code } : {}) };
  if (now - prior.updatedAt >= STALE_MS) return { kind: "run" };
  return { kind: "refuse", status: 409, message: "this render is already running; its progress is in the step log" };
}

const ref = (renderId: string) => firestore().collection("renderRequests").doc(renderId);

/** Claim the render id, or say why not (in one transaction, so two identical requests can't both run). */
export async function claimRender(renderId: string, brandUid: string, fingerprint: string): Promise<ClaimDecision> {
  return firestore().runTransaction(async (tx) => {
    const s = await tx.get(ref(renderId));
    const d = claimDecision(s.data() as RenderRequestDoc | undefined, brandUid, fingerprint);
    if (d.kind === "run") {
      const now = Date.now();
      tx.set(ref(renderId), { brandId: brandUid, fingerprint, state: "running", createdAt: (s.data() as RenderRequestDoc | undefined)?.createdAt ?? now, updatedAt: now } satisfies RenderRequestDoc);
    }
    return d;
  });
}

export async function finishClaim(renderId: string, outcome: { result: unknown } | { error: { status: number; message: string; code?: string } }) {
  const patch = "result" in outcome ? { state: "done", result: JSON.parse(JSON.stringify(outcome.result)) } : { state: "failed", error: outcome.error };
  await ref(renderId).set({ ...patch, updatedAt: Date.now() }, { merge: true });
}
