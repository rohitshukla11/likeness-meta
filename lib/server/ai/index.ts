import "server-only";
/**
 * AI_PROVIDER switch: "google" (the default for now) keeps likeness-ai's behaviour on Vertex AI Gemini;
 * "meta" uses the Meta Model API: Muse Image, Muse Spark (brand agent and reviewer) and SAM 3.1 (people in
 * the consent gate). One set of services per process.
 */
import { geminiBrandAgent } from "./google/agent";
import { geminiImageGenerator } from "./google/image";
import { fixtureBrandAgent } from "./fixture/agent";
import { fixtureImageGenerator } from "./fixture/image";
import { localFaceSegmenter } from "./local/segmenter";
import { museImageGenerator } from "./meta/image";
import { samSegmenter } from "./meta/sam";
import { sparkBrandAgent, sparkReviewer } from "./meta/spark";
import type { AiProvider, AiServices, OutputReviewer } from "./types";

export function aiProvider(value = process.env.AI_PROVIDER): AiProvider {
  const v = (value ?? "google").trim().toLowerCase() || "google";
  if (v !== "google" && v !== "meta" && v !== "fixture") throw Object.assign(new Error(`AI_PROVIDER must be "google" or "meta", not "${value}"`), { status: 500 });
  if (v === "fixture" && process.env.NODE_ENV === "production") throw Object.assign(new Error("AI_PROVIDER=fixture is for development only and is refused in production"), { status: 500 });
  return v;
}

/** likeness-ai has no output reviewer; with google the step is recorded as skipped. */
const skippedReviewer: OutputReviewer = {
  review: async () => ({ verdict: "pass", skipped: true, findings: [], reasons: ["No output reviewer with this AI provider (google, as in likeness-ai; or the development fixture)."], metrics: null }),
};

function build(provider: AiProvider): AiServices {
  // Development only, no model calls at all: a stored image, an offline policy stand-in, the local face counter.
  if (provider === "fixture") return { provider, imageGenerator: fixtureImageGenerator, segmenter: localFaceSegmenter, brandAgent: fixtureBrandAgent, reviewer: skippedReviewer };
  if (provider === "meta") return { provider, imageGenerator: museImageGenerator, segmenter: samSegmenter, brandAgent: sparkBrandAgent, reviewer: sparkReviewer };
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
