import "server-only";
/**
 * A spending cap for paid scripts (--max-usd, required for every paid run of scripts/eval.ts and the check
 * scripts). Every Meta call goes through lib/server/ai/meta/client.ts, which asks here first: the call's
 * estimated price (lib/server/ai/pricing.ts) is added to what was spent so far, and if that would pass the
 * cap the call is never made (BudgetExceeded). After the call, its cost from the usage Meta reports replaces
 * the estimate. A rejected request (HTTP 4xx) costs nothing. The server never sets a cap. Estimates only:
 * Meta's bill is the source of truth. Gemini calls (AI_PROVIDER=google) have no pinned price and aren't counted.
 */
import { estimateCost } from "./pricing";

export class BudgetExceeded extends Error {
  readonly code = "BUDGET_EXCEEDED";
  readonly status = 402;
}

/** A stop by the cap passes through the pipeline's fail-closed handlers: it isn't a refusal or a block. */
export const isBudgetStop = (e: unknown): boolean => e instanceof BudgetExceeded;

let cap: { maxUsd: number; spentUsd: number; calls: number } | null = null;

export function setBudget(maxUsd: number | null): void {
  cap = maxUsd === null ? null : { maxUsd, spentUsd: 0, calls: 0 };
}

export const budgetState = () => (cap ? { ...cap } : null);

/** Spark's output allowance for the estimate: about the most a call has used (a plan at "high": 1,668 tokens). */
const SPARK_OUTPUT_ALLOWANCE = 2000;
/** What one input image is counted as, in tokens, for a Spark estimate. */
const SPARK_TOKENS_PER_IMAGE = 1500;

/** A call's estimated price before it is made, from its request body. Pure. */
export function estimateBefore(body: unknown): number {
  const b = (body ?? {}) as { model?: string; max_output_tokens?: number };
  const model = String(b.model ?? "");
  if (model.startsWith("muse-image")) return estimateCost("meta", model, undefined, 1)?.costUsd ?? 0.01;
  if (model.startsWith("sam")) return estimateCost("meta", model, undefined, 1)?.costUsd ?? 0.0025;
  // Spark: the text sent (images counted separately), plus an output allowance.
  const raw = JSON.stringify(body ?? {});
  const images = (raw.match(/data:image\/[a-z]+;base64,/g) ?? []).length;
  const text = raw.replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, "");
  const output = Math.min(b.max_output_tokens ?? SPARK_OUTPUT_ALLOWANCE, SPARK_OUTPUT_ALLOWANCE);
  return estimateCost("meta", model, { input_tokens: Math.ceil(text.length / 4) + images * SPARK_TOKENS_PER_IMAGE, output_tokens: output })?.costUsd ?? 0;
}

/** Before a call: throws, and nothing is sent, if it could take the spend past the cap. Returns the estimate. */
export function reserve(body: unknown): number {
  const est = estimateBefore(body);
  if (cap && cap.spentUsd + est > cap.maxUsd + 1e-9) {
    throw new BudgetExceeded(`--max-usd ${cap.maxUsd}: spent about $${cap.spentUsd.toFixed(4)} so far; the next call (${String((body as { model?: string })?.model)}, about $${est.toFixed(4)}) could pass it, so it wasn't made`);
  }
  return est;
}

/** After a call: its cost from the reported usage, or the estimate when there is none (a stream); 0 when Meta refused the request. */
export function record(body: unknown, est: number, outcome: { usage?: Record<string, unknown>; refused?: boolean }): void {
  if (!cap) return;
  cap.calls++;
  if (outcome.refused) return;
  const model = String((body as { model?: string })?.model ?? "");
  const actual = outcome.usage && model.startsWith("muse-spark") ? estimateCost("meta", model, outcome.usage)?.costUsd : null;
  cap.spentUsd += actual ?? est;
}

/** For paid scripts: --max-usd <dollars>, required. Free runs (the fixture provider) may leave it out. */
export function budgetFromArgs(argv: string[], paid: boolean): number | null {
  const i = argv.indexOf("--max-usd");
  const v = i >= 0 ? Number(argv[i + 1]) : NaN;
  if (i >= 0 && !(Number.isFinite(v) && v > 0)) throw new Error("--max-usd needs an amount in dollars, e.g. --max-usd 0.05");
  if (paid && i < 0) throw new Error("this run makes billed calls: add --max-usd <dollars> (it stops before a call would pass that)");
  const max = i >= 0 ? v : null;
  setBudget(max);
  return max;
}

export const budgetSummary = () => (cap ? `spent about $${cap.spentUsd.toFixed(4)} of --max-usd ${cap.maxUsd} (${cap.calls} Meta call${cap.calls === 1 ? "" : "s"}; estimates, the bill is the source of truth)` : "no --max-usd set");
