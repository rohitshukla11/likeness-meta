/**
 * The AI layer behind provider-neutral interfaces. AI_PROVIDER picks the implementation
 * (lib/server/ai/index.ts): "google" keeps likeness-ai's behaviour (Vertex AI Gemini); "meta" uses the
 * Meta Model API (Muse Image, SAM 3.1, Muse Spark). Everything else (licences, credits, receipts, C2PA,
 * storage) stays the same whichever provider renders.
 *
 * Rules every implementation follows:
 *  - images in are the creator's consented reference frames (and, for multiImage, the brand's product
 *    photo); implementations never keep them, never log them, and never fetch other images;
 *  - the licence policy code decides (lib/server/ai/policy.ts); a model only proposes and explains.
 */
import type { Aspect } from "@/lib/creative";
import type { LicenceDoc } from "@/lib/model";

export type AiProvider = "google" | "meta";

export type ImageInput = { bytes: Uint8Array; mime: "image/jpeg" | "image/png" };

/** What a call cost and how long it took, for the per-render cost and latency log. */
export type CallMetrics = {
  /** "local" for checks that run on this server (YuNet, AuraFace). */
  provider: AiProvider | "local";
  model: string;
  latencyMs: number;
  /** Provider-reported usage, as returned (token counts, image counts). */
  usage?: Record<string, unknown>;
  /** Estimated cost in US dollars, when the provider's price is known; null otherwise. */
  costUsd: number | null;
};

// ---------------------------------------------------------------- ImageGenerator

export type ImageOptions = {
  aspectRatio: Aspect;
  /** "draft": small and cheap (development); "full": full quality (demo mode). */
  quality: "draft" | "full";
  /** For logs only: which licence and render this call is for. */
  licenceId: string;
  renderIndex: number;
};

export type GeneratedImage = ImageInput & { metrics: CallMetrics };

export interface ImageGenerator {
  readonly provider: AiProvider;
  /** A new image of the person in the reference photos, following the prompt. */
  edit(referenceImages: ImageInput[], prompt: string, options: ImageOptions): Promise<GeneratedImage>;
  /** The same, with the brand's product photo composed into the scene. */
  multiImage(referenceImages: ImageInput[], productImage: ImageInput, prompt: string, options: ImageOptions): Promise<GeneratedImage>;
}

// ---------------------------------------------------------------- PersonSegmenter

/** A box as fractions of the image (0–1), with the detector's confidence. */
export type Box = { x: number; y: number; w: number; h: number; score: number };

/** A mask for one detected person: a single-channel PNG the size of the image (white = person). */
export type Mask = { png: Uint8Array; width: number; height: number };

export type PeopleDetection = {
  /** How many people are in the image. */
  count: number;
  /** One box per person, best first. */
  boxes: Box[];
  /** One mask per person, in the same order as boxes; empty when the segmenter gives no masks. */
  masks: Mask[];
  /** Faces, when the segmenter finds them separately (SAM 3.1 with a "face" prompt; YuNet locally). */
  faces?: Box[];
  metrics: CallMetrics;
};

export interface PersonSegmenter {
  detectPeople(image: ImageInput): Promise<PeopleDetection>;
}

// ---------------------------------------------------------------- BrandAgent

/** The brand's brief: the creative assistant's inputs, plus free text and how many shots to plan. */
export type BrandBrief = {
  text?: string;
  idea: string;
  product: string;
  setting: string;
  mood: "warm" | "energetic" | "premium" | "playful";
  aspect: Aspect;
  /** How many shots the brand wants (1 by default). */
  shots?: number;
};

/** A shot the model proposes. Nothing is rendered until the policy code allows it. */
export type ShotProposal = {
  id: string;
  /** The full image prompt for this shot. */
  prompt: string;
  aspect: Aspect;
  /** The model's one-line reason for the shot. */
  rationale: string;
};

/** Why the policy code refused something; each has a plain-language explanation (policy.ts, explain). */
export type RefusalCode =
  | "EMPTY_BRIEF"
  | "BANNED_USE"
  | "OUTSIDE_LICENSED_USE"
  | "LICENCE_REVOKED"
  | "LICENCE_EXPIRED"
  | "OVER_CAP"
  | "DAILY_LIMIT"
  | "MODEL_REFUSED"
  | "POLICY_CHECK_FAILED";

export type ShotDecision = {
  shotId: string | null;
  allowed: boolean;
  code: RefusalCode | null;
  /** Plain language, for the brand: why it was allowed or refused. */
  explanation: string;
};

export type ShotPlan = {
  shots: ShotProposal[];
  /** One decision per shot, plus licence-wide refusals (shotId null). Decided by code, not the model. */
  decisions: ShotDecision[];
  metrics: CallMetrics;
};

/** The model layer of the prompt filter (after the keyword rules, before any render). */
export type ModelPolicyVerdict = {
  banned: string[];
  fitsCategory: boolean;
  reason: string;
  metrics: CallMetrics;
};

export interface BrandAgent {
  /** Name used in the filter's layer list and reasons ("Gemini", "Muse Spark"). */
  readonly label: string;
  /** What to configure for the model check, named in the filter's note ("GOOGLE_CLOUD_PROJECT", "MODEL_API_KEY"). */
  readonly configHint: string;
  /** Refuse renders when the model check isn't configured (meta); google runs rules only, as in likeness-ai. */
  readonly requiresPolicyCheck: boolean;
  /** Whether the model check can run here. */
  policyConfigured(): boolean;
  /** The model proposes shots for the brief; the licence policy code decides each one. */
  planShots(brief: BrandBrief, licence: LicenceDoc): Promise<ShotPlan>;
  /** The model's banned-use and category-fit check of one prompt. Throws on failure (the caller refuses). */
  checkPolicy(prompt: string, licence: LicenceDoc): Promise<ModelPolicyVerdict>;
}

// ---------------------------------------------------------------- OutputReviewer

export type ReviewResult = {
  pass: boolean;
  /** Plain language, one per finding; on a pass, what was checked. */
  reasons: string[];
  /** True when no reviewer ran (the google provider has none); the pipeline records it as skipped. */
  skipped?: boolean;
  metrics: CallMetrics | null;
};

export interface OutputReviewer {
  /** Does the finished image match the brief and the licence (right product, allowed setting, nothing banned)? */
  review(image: ImageInput, brief: string, licence: LicenceDoc): Promise<ReviewResult>;
}

export type AiServices = {
  provider: AiProvider;
  imageGenerator: ImageGenerator;
  segmenter: PersonSegmenter;
  brandAgent: BrandAgent;
  reviewer: OutputReviewer;
};
