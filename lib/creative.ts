/**
 * The creative assistant's shared vocabulary: templates, moods, and the framing and motion rules.
 * The rules are appended by the server to every still prompt and every Veo prompt, whether or not
 * the brand used the assistant, so a face is never framed out by a short brief.
 */

export type Aspect = "1:1" | "16:9" | "9:16";
export type VideoAspect = "16:9" | "9:16";
export type Mood = "warm" | "energetic" | "premium" | "playful";
export type AdFormat = "image" | "video";

export const MOODS: Mood[] = ["warm", "energetic", "premium", "playful"];

export type AssistantInput = {
  idea: string;
  product: string;
  setting: string;
  mood: Mood;
  aspect: Aspect;
  format: AdFormat;
};

export type PromptDetails = {
  subject: string;
  action: string;
  setting: string;
  wardrobe: string;
  composition: string;
  style: string;
};

export type AssistantDraft = {
  /** The detailed still prompt; it fills the Brief box and stays editable. */
  brief: string;
  details: PromptDetails;
  /** Video ads only: what happens on screen. */
  motion: string | null;
  aspect: Aspect;
  format: AdFormat;
  source: "gemini" | "template";
  note?: string;
};

export const DEFAULT_INPUT: AssistantInput = { idea: "", product: "", setting: "", mood: "warm", aspect: "1:1", format: "image" };

export const TEMPLATES: { key: string; label: string; input: Partial<AssistantInput> }[] = [
  { key: "product", label: "Product in hand", input: { idea: "product showcase", setting: "clean studio with soft daylight", mood: "warm" } },
  { key: "cafe", label: "Lifestyle café", input: { idea: "everyday café moment", product: "ceramic coffee cup", setting: "sunlit café", mood: "warm" } },
  { key: "unboxing", label: "Unboxing", input: { idea: "opening the product box for the first time", setting: "bright living-room table", mood: "playful" } },
  // A visual style only: no spoken lines, quotes or claims are written for the person.
  { key: "smile", label: "Testimonial-style smile", input: { idea: "warm direct-to-camera smile, no spoken lines or quotes", setting: "softly lit home interior", mood: "warm" } },
  { key: "outdoor", label: "Outdoor active", input: { idea: "active morning outdoors", setting: "park trail in early morning light", mood: "energetic" } },
  { key: "studio", label: "Studio portrait", input: { idea: "clean studio portrait", setting: "seamless studio backdrop, softbox lighting", mood: "premium" } },
];

export const FRAMING_RULES =
  "Framing: medium close-up of the person, the full head and face visible with clear headroom above the hair, eyes in the upper third, looking toward the camera with a natural expression; never crop the forehead, chin or face; hands and any product fully inside the frame.";

export const ASPECT_GUIDANCE: Record<Aspect, string> = {
  "1:1": "Square framing: the person centred, clean space on one side for a headline.",
  "16:9": "Horizontal framing: the person on the left or right third, clean space on the other side for a headline.",
  "9:16": "Vertical framing: the person in the centre third, clean space above or below for a headline.",
};

export const MOTION_RULES =
  "Subtle slow camera push-in or gentle drift; natural, relaxed movement; the full face stays in frame and well lit for the whole clip; keep the person's identity unchanged; no text, captions or logos generated.";

/** The retry after a failed quality gate: a near-static camera that cannot frame the face out. */
export const STRICT_MOTION_RULES =
  "Static or nearly static camera, no zoom-in, no cut; the entire head and shoulders stay inside the frame at all times, the face fully visible and facing the camera; small, calm movements only.";

export const VIDEO_AVOID = "Avoid: the face cropped or leaving the frame, the head turned away, extra people, distorted features, text, captions, logos, watermarks.";

/** What the server adds to every still prompt. */
export const stillRules = (aspect: Aspect) => `${FRAMING_RULES} ${ASPECT_GUIDANCE[aspect]} No text, logos or watermarks in the image.`;

/** The full Veo prompt: the brand's motion, then our rules. */
export const veoPrompt = (motion: string, aspect: VideoAspect, strict = false) =>
  [motion.trim(), strict ? STRICT_MOTION_RULES : MOTION_RULES, FRAMING_RULES, ASPECT_GUIDANCE[aspect], VIDEO_AVOID].join("\n");
