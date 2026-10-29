/**
 * The creative assistant's shared vocabulary: templates, moods, and the framing rules. The rules are
 * appended by the server to every image prompt, whether or not the brand used the assistant, so a
 * face is never framed out by a short brief.
 */

export type Aspect = "1:1" | "16:9" | "9:16";
export type Mood = "warm" | "energetic" | "premium" | "playful";

export const MOODS: Mood[] = ["warm", "energetic", "premium", "playful"];

export type AssistantInput = {
  idea: string;
  product: string;
  setting: string;
  mood: Mood;
  aspect: Aspect;
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
  aspect: Aspect;
  source: "gemini" | "muse-spark" | "template";
  note?: string;
};

export const DEFAULT_INPUT: AssistantInput = { idea: "", product: "", setting: "", mood: "warm", aspect: "1:1" };

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

/** What the server adds to every still prompt. */
export const stillRules = (aspect: Aspect) => `${FRAMING_RULES} ${ASPECT_GUIDANCE[aspect]} No text, logos or watermarks in the image.`;
