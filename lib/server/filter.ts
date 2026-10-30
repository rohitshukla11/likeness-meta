import "server-only";
/**
 * Prompt check before any render. Two layers:
 *  1. Local rules, always: keyword and phrase rules for the five banned uses (political, adult,
 *     minors, impersonation, deception). Cheap, deterministic, and blunt.
 *  2. The BrandAgent's model check (lib/server/ai: Gemini on Vertex AI for AI_PROVIDER=google, Muse
 *     Spark for meta) with structured JSON output: banned-use judgement plus whether the prompt fits
 *     the licence's one licensed category. If the call fails, the render is refused (fail closed).
 * Not configured (no GOOGLE_CLOUD_PROJECT for google, no MODEL_API_KEY for meta): the render is refused
 * too. Every render needs both layers.
 */
import { isBudgetStop } from "./ai/budget";
import { CATEGORIES } from "@/lib/categories";
import type { LicenceDoc } from "@/lib/model";
import { ai } from "./ai";
import type { CallMetrics } from "./ai/types";
import { ruleCheck } from "./rules";

export type FilterResult = {
  allowed: boolean;
  reasons: string[];
  layers: { name: string; ran: boolean; note?: string }[];
  /** The policy model call, when it ran: for the render's cost and latency. */
  metrics?: CallMetrics;
};

export async function checkPrompt(prompt: string, licence: LicenceDoc): Promise<FilterResult> {
  const category = CATEGORIES.find((c) => c.key === licence.use)?.label ?? "unknown";
  const reasons: string[] = [];
  const layers: FilterResult["layers"] = [];
  let metrics: CallMetrics | undefined;

  if (prompt.trim().length < 3) reasons.push("prompt is empty");
  if (prompt.length > 2000) reasons.push("prompt is longer than 2000 characters");
  const hits = ruleCheck(prompt);
  reasons.push(...hits.map((h) => `banned use (rules) — ${h}`));
  layers.push({ name: "Local banned-use rules", ran: true });

  const agent = ai().brandAgent;
  if (agent.policyConfigured()) {
    try {
      const q = await agent.checkPolicy(prompt, licence);
      metrics = q.metrics;
      for (const b of q.banned) reasons.push(`banned use (${agent.label}) — ${b}: ${q.reason}`);
      if (!q.fitsCategory) reasons.push(`outside the licensed use (${category}) — ${q.reason}`);
      layers.push({ name: `${agent.label} LLM filter (${q.metrics.model})`, ran: true });
    } catch (e) {
      if (isBudgetStop(e)) throw e;
      reasons.push(`LLM filter failed, so the render is refused: ${(e as Error).message}`);
      layers.push({ name: `${agent.label} LLM filter`, ran: false, note: "call failed (fail closed)" });
    }
  } else {
    reasons.push(`LLM filter not configured (${agent.configHint}), so the render is refused`);
    layers.push({ name: `${agent.label} LLM filter`, ran: false, note: `not configured (${agent.configHint}): fail closed` });
  }
  return { allowed: reasons.length === 0, reasons, layers, ...(metrics ? { metrics } : {}) };
}
