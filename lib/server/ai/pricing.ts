/**
 * Every price the app uses, in one place, to estimate a call's cost from its usage. Estimates only:
 * the provider's bill is the source of truth.
 *
 * Meta Model API, Standard mode, from https://dev.meta.ai/docs/pricing-rate-limits (read 2026-10-29):
 *   Muse Spark 1.3 / 1.2 / 1.1: $1.25 input, $0.15 cached input, $4.25 output per 1M tokens;
 *   Muse Image: $0.01 per generated image (its built-in search included); images that fail or are
 *   removed by safety filtering aren't billed; the usage tokens in its responses are "for reference"
 *   and not billed on top (pricing page; to be confirmed against the first real call and the bill);
 *   SAM 3.1: $2.50 per 1,000 images segmented.
 * Reasoning tokens are counted within output_tokens (Responses API reference, Response Usage), so they
 * are priced as output tokens.
 * Vertex AI Gemini: no price is pinned here yet (the pricing page couldn't be read), so Gemini calls
 * record their usage with no cost estimate (null) rather than a guessed one.
 */
import type { AiProvider, CostEstimate } from "./types";

export const PRICES_AS_OF = "2026-10-29";

/** Show brands the estimated model cost of their renders (SHOW_MODEL_COST=0 hides it; on by default). */
export const showModelCost = () => !["0", "false", "off"].includes((process.env.SHOW_MODEL_COST ?? "").trim().toLowerCase());

type Price =
  | { unit: "tokens"; inputPerM: number; cachedInputPerM: number; outputPerM: number }
  | { unit: "image"; perImage: number };

const PRICES: Record<string, Price> = {
  "muse-spark-1.3": { unit: "tokens", inputPerM: 1.25, cachedInputPerM: 0.15, outputPerM: 4.25 },
  "muse-spark-1.2": { unit: "tokens", inputPerM: 1.25, cachedInputPerM: 0.15, outputPerM: 4.25 },
  "muse-spark-1.1": { unit: "tokens", inputPerM: 1.25, cachedInputPerM: 0.15, outputPerM: 4.25 },
  "muse-image-1.0": { unit: "image", perImage: 0.01 },
  "sam-3.1": { unit: "image", perImage: 2.5 / 1000 },
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * The estimated cost of one call. `usage` is the provider's usage object as returned (Responses API:
 * input_tokens, output_tokens, input_tokens_details.cached_tokens); `images` is how many images were
 * generated or segmented. Null when the model has no pinned price.
 */
export function estimateCost(provider: AiProvider | "local", model: string, usage: Record<string, unknown> | undefined, images = 0): CostEstimate | null {
  if (provider === "local") return { costUsd: 0, estimate: true, basis: "runs on this server" };
  if (provider === "fixture") return { costUsd: 0, estimate: true, basis: "fixture: no model call" };
  const p = PRICES[model];
  if (!p) return null;
  if (p.unit === "image") return { costUsd: round(images * p.perImage), estimate: true, basis: `${images} × $${p.perImage} per image (${model}, prices of ${PRICES_AS_OF})` };
  const cached = num((usage?.input_tokens_details as Record<string, unknown> | undefined)?.cached_tokens);
  const input = Math.max(0, num(usage?.input_tokens) - cached);
  const output = num(usage?.output_tokens);
  const usd = (input * p.inputPerM + cached * p.cachedInputPerM + output * p.outputPerM) / 1e6;
  return { costUsd: round(usd), estimate: true, basis: `${input} input, ${cached} cached, ${output} output tokens (${model}, prices of ${PRICES_AS_OF})` };
}

const round = (usd: number) => Math.round(usd * 1e6) / 1e6;

export type RenderStep = "plan" | "policy" | "generate" | "consent" | "review" | "alternative";

/** One render's cost: every model call it made, summed. Stored on delivered and blocked renders alike. */
export type RenderCost = {
  costUsd: number;
  estimate: true;
  /** False when a call had no pinned price (Gemini): costUsd then counts only the priced calls. */
  complete: boolean;
  calls: { step: RenderStep; provider: string; model: string; latencyMs: number; costUsd: number | null }[];
};

export function renderCost(calls: { step: RenderStep; metrics: { provider: string; model: string; latencyMs: number; cost: CostEstimate | null } }[]): RenderCost {
  const rows = calls.map(({ step, metrics: m }) => ({ step, provider: m.provider, model: m.model, latencyMs: m.latencyMs, costUsd: m.cost?.costUsd ?? null }));
  return { costUsd: round(rows.reduce((s, r) => s + (r.costUsd ?? 0), 0)), estimate: true, complete: rows.every((r) => r.costUsd !== null), calls: rows };
}
