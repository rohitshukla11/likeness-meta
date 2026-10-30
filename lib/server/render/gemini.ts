import "server-only";
/**
 * Gemini image generation from the creator's reference frames (gemini-nano-banana-2.1 on Vertex AI).
 * One generateContent call: the reference frames as inline images, then the brand's brief, with
 * responseModalities ["IMAGE"]. The image comes back inline (base64), so nothing is fetched from a URL.
 *
 * Google adds an invisible SynthID watermark to images these models generate, a second, independent
 * provenance signal next to our C2PA manifest and KMS-signed receipt.
 */
import { generateContent, geminiModels } from "../gemini";
import { stillRules, type Aspect } from "@/lib/creative";
import type { RenderInput, RenderOutput } from "./types";

const MAX_REFERENCES = 3;

/** The brief, then our framing rules for the aspect: always appended, so a short brief can't frame the face out. */
export function referencePrompt(prompt: string, n: number, aspect: Aspect = "1:1", withProduct = false): string {
  return [
    `The ${n === 1 ? "image shows" : `${n} images show`} one real, consenting adult who has licensed their likeness for this image.`,
    ...(withProduct ? [`The last image (after those ${n}) is the brand's product photo: show that exact product, as it appears there.`] : []),
    "Generate a new photorealistic image of exactly this person, keeping their face, identity and likeness faithful to the reference photos.",
    "Do not add text, logos or watermarks unless asked.",
    `Brief: ${prompt}`,
    stillRules(aspect),
  ].join("\n");
}

export async function geminiRender(input: RenderInput): Promise<RenderOutput> {
  const model = geminiModels.image();
  const refs = input.references.slice(0, MAX_REFERENCES);
  const res = await generateContent(model, {
    contents: [
      {
        role: "user",
        parts: [
          ...refs.map((r) => ({ inlineData: { mimeType: "image/jpeg", data: Buffer.from(r).toString("base64") } })),
          ...(input.product ? [{ inlineData: { mimeType: input.product.mime, data: Buffer.from(input.product.bytes).toString("base64") } }] : []),
          { text: referencePrompt(input.prompt, refs.length, input.aspectRatio ?? "1:1", !!input.product) },
        ],
      },
    ],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: input.aspectRatio || process.env.GEMINI_ASPECT_RATIO || "1:1", imageSize: process.env.GEMINI_IMAGE_SIZE || "1K" } },
  });
  if (res.promptFeedback?.blockReason) throw new Error(`Gemini blocked the request: ${res.promptFeedback.blockReason} ${res.promptFeedback.blockReasonMessage ?? ""}`.trim());
  const c = res.candidates?.[0];
  const image = c?.content?.parts?.find((p) => p.inlineData?.data && !p.thought)?.inlineData;
  if (!image) throw new Error(`Gemini returned no image (finishReason ${c?.finishReason ?? "none"}${c?.finishMessage ? `: ${c.finishMessage}` : ""})`);
  const mime = image.mimeType === "image/jpeg" ? "image/jpeg" : "image/png";
  return { bytes: new Uint8Array(Buffer.from(image.data, "base64")), mime, provider: "gemini", model, test: false, usage: res.usageMetadata };
}
