import "server-only";
/**
 * AI_PROVIDER switch: "meta" (the default) uses the Meta Model API: Muse Image, Muse Spark (brand agent and
 * reviewer) and SAM 3.1 (people in the consent gate). "google" is the fallback: Vertex AI Gemini, as in
 * likeness-ai, with the local face counter and no reviewer. One set of services per process.
 */
import { geminiBrandAgent } from "./google/agent";
import { geminiImageGenerator } from "./google/image";
import { fixtureBrandAgent } from "./fixture/agent";
import { fixtureImageGenerator } from "./fixture/image";
import { localFaceSegmenter } from "./local/segmenter";
import { MUSE_IMAGE_SIZES, museImageGenerator } from "./meta/image";
import { samSegmenter } from "./meta/sam";
import { sparkBrandAgent, sparkReviewer } from "./meta/spark";
import { ASPECTS, type Aspect } from "@/lib/creative";
import type { AiProvider, AiServices, OutputReviewer } from "./types";

export function aiProvider(value = process.env.AI_PROVIDER): AiProvider {
  const v = (value ?? "meta").trim().toLowerCase() || "meta";
  if (v !== "google" && v !== "meta" && v !== "fixture") throw Object.assign(new Error(`AI_PROVIDER must be "google" or "meta", not "${value}"`), { status: 500 });
  if (v === "fixture" && process.env.NODE_ENV === "production") throw Object.assign(new Error("AI_PROVIDER=fixture is for development only and is refused in production"), { status: 500 });
  return v;
}

/** No output reviewer with google or the development fixture; the step is recorded as skipped. */
const skippedReviewer: OutputReviewer = {
  review: async () => ({ verdict: "pass", skipped: true, findings: [], reasons: ["No reviewer for this provider."], metrics: null }),
};

function build(provider: AiProvider): AiServices {
  // Development only, no model calls at all: a stored image, an offline policy stand-in, the local face counter.
  if (provider === "fixture") return { provider, imageGenerator: fixtureImageGenerator, segmenter: localFaceSegmenter, brandAgent: fixtureBrandAgent, reviewer: skippedReviewer };
  if (provider === "meta") return { provider, imageGenerator: museImageGenerator, segmenter: samSegmenter, brandAgent: sparkBrandAgent, reviewer: sparkReviewer };
  return { provider, imageGenerator: geminiImageGenerator, segmenter: localFaceSegmenter, brandAgent: geminiBrandAgent, reviewer: skippedReviewer };
}

const cache = new Map<AiProvider, AiServices>();
/** Gemini's shapes, as in likeness-ai. */
const GOOGLE_ASPECTS: Aspect[] = ["1:1", "16:9", "9:16"];

/** The shapes this provider can make: meta, the sizes Muse Image is confirmed to accept; the fixture, any. */
export function supportedAspects(provider: AiProvider = aiProvider()): Aspect[] {
  if (provider === "meta") return ASPECTS.filter((a) => MUSE_IMAGE_SIZES[a]);
  return provider === "google" ? GOOGLE_ASPECTS : ASPECTS;
}

/** Refuse an aspect the provider can't make, before any model call (so nothing is spent on planning or policy). */
export function assertAspect(aspect: Aspect): void {
  const ok = supportedAspects();
  if (!ok.includes(aspect)) throw Object.assign(new Error(`${aspect} images aren't available with this AI provider yet; choose ${ok.join(" or ")}.`), { status: 422, code: "UNSUPPORTED_SIZE" });
}

export function ai(): AiServices {
  const p = aiProvider();
  let s = cache.get(p);
  if (!s) cache.set(p, (s = build(p)));
  return s;
}

export type * from "./types";
