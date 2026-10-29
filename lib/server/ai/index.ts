import "server-only";
/**
 * AI_PROVIDER switch: "google" (the default) keeps likeness-ai's behaviour on Vertex AI Gemini; "meta"
 * uses the Meta Model API. One set of services per process.
 */
import { geminiBrandAgent } from "./google/agent";
import { geminiImageGenerator } from "./google/image";
import { localFaceSegmenter } from "./local/segmenter";
import type { AiProvider, AiServices, OutputReviewer } from "./types";

export function aiProvider(value = process.env.AI_PROVIDER): AiProvider {
  const v = (value ?? "google").trim().toLowerCase() || "google";
  if (v !== "google" && v !== "meta") throw Object.assign(new Error(`AI_PROVIDER must be "google" or "meta", not "${value}"`), { status: 500 });
  return v;
}

/** likeness-ai has no output reviewer; with google the step is recorded as skipped. */
const skippedReviewer: OutputReviewer = {
  review: async () => ({ pass: true, skipped: true, reasons: ["No output reviewer with AI_PROVIDER=google (as in likeness-ai)."], metrics: null }),
};

function build(provider: AiProvider): AiServices {
  if (provider === "meta") throw Object.assign(new Error("AI_PROVIDER=meta: the Meta adapters are not built yet (Phase 3)"), { status: 503 });
  return { provider, imageGenerator: geminiImageGenerator, segmenter: localFaceSegmenter, brandAgent: geminiBrandAgent, reviewer: skippedReviewer };
}

const cache = new Map<AiProvider, AiServices>();
export function ai(): AiServices {
  const p = aiProvider();
  let s = cache.get(p);
  if (!s) cache.set(p, (s = build(p)));
  return s;
}

export type * from "./types";
