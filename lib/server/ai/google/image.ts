import "server-only";
/**
 * ImageGenerator on Vertex AI Gemini: likeness-ai's renderer (lib/server/render/gemini.ts) behind the
 * provider-neutral interface, kept as the fallback for AI_PROVIDER=google.
 * Output size follows GEMINI_IMAGE_SIZE exactly as in likeness-ai; `quality` is not used here, so the
 * google provider behaves as before. Cost: from the pricing table (lib/server/ai/pricing.ts), which has
 * no Gemini price yet, so null.
 */
import { geminiRender } from "../../render/gemini";
import { estimateCost } from "../pricing";
import type { GeneratedImage, ImageGenerator, ImageInput, ImageOptions } from "../types";

async function render(referenceImages: ImageInput[], prompt: string, options: ImageOptions, product?: ImageInput): Promise<GeneratedImage> {
  const t = Date.now();
  const out = await geminiRender({
    prompt,
    references: referenceImages.map((r) => r.bytes),
    product,
    licenceId: options.licenceId,
    renderIndex: options.renderIndex,
    aspectRatio: options.aspectRatio,
  });
  return { bytes: out.bytes, mime: out.mime, metrics: { provider: "google", model: out.model, latencyMs: Date.now() - t, usage: out.usage, cost: estimateCost("google", out.model, out.usage, 1) } };
}

export const geminiImageGenerator: ImageGenerator = {
  provider: "google",
  edit: (referenceImages, prompt, options) => render(referenceImages, prompt, options),
  multiImage: (referenceImages, productImage, prompt, options) => render(referenceImages, prompt, options, productImage),
};
