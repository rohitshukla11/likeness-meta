import "server-only";
/**
 * ImageGenerator on Meta Muse Image (muse-image-1.0) over the Responses API, POST /v1/responses with the
 * image_generation tool (https://dev.meta.ai/docs/image-generation; field names as in the Meta
 * console's "Get code").
 *
 *  - Image search, web search and shell are always off, set here in code, never from configuration:
 *    the image must come only from the creator's consented reference photos (and the brand's product
 *    photo), never from anything the model finds on the web.
 *  - store: false and stream: false on every call: nothing is kept on Meta's side for later turns.
 *  - Images go only as base64 data URLs built in memory from the decrypted frames, never as public or
 *    signed URLs, and are never logged.
 *  - size sets the aspect ratio only ("WxH"; the generator picks the pixel size). `quality` has no
 *    Muse Image setting: the output resolution is the generator's own.
 *  - temperature, top_p, max_output_tokens and reasoning_strength are configurable, with the console
 *    defaults (0.6, 0.9, 2048, "high"); reasoning_strength is recorded with each call's latency
 *    ("low" is a single pass: faster, less refined, same price).
 * Price: $0.01 per generated image (lib/server/ai/pricing.ts).
 */
import sharp from "sharp";
import type { Aspect } from "@/lib/creative";
import { referencePrompt } from "../../render/gemini";
import { estimateCost } from "../pricing";
import type { GeneratedImage, ImageGenerator, ImageInput, ImageOptions } from "../types";
import { MetaApiError, metaPost } from "./client";

/** Never configurable: the image comes only from the images we send. */
export const MUSE_IMAGE_TOOL_SWITCHES = Object.freeze({ enable_image_search: false, enable_web_search: false, enable_shell: false } as const);

/** Aspect → the tool's size ("WxH" sets the aspect ratio, not the pixel size). */
export const MUSE_IMAGE_SIZES: Record<Aspect, string> = { "1:1": "1024x1024", "16:9": "1792x1008", "9:16": "1008x1792" };

export type MuseImageConfig = { model: string; temperature: number; topP: number; maxOutputTokens: number; reasoningStrength: "high" | "low" };

const numberIn = (name: string, fallback: number, lo: number, hi: number) => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`${name} must be a number from ${lo} to ${hi}`);
  return v;
};

export function museImageConfig(): MuseImageConfig {
  const rs = (process.env.MUSE_IMAGE_REASONING_STRENGTH || "high").trim();
  if (rs !== "high" && rs !== "low") throw new Error('MUSE_IMAGE_REASONING_STRENGTH must be "high" or "low"');
  return {
    model: process.env.MUSE_IMAGE_MODEL || "muse-image-1.0",
    temperature: numberIn("MUSE_IMAGE_TEMPERATURE", 0.6, 0, 2),
    topP: numberIn("MUSE_IMAGE_TOP_P", 0.9, 0, 1),
    maxOutputTokens: Math.floor(numberIn("MUSE_IMAGE_MAX_OUTPUT_TOKENS", 2048, 1, 131_072)),
    reasoningStrength: rs,
  };
}

const dataUrl = (img: ImageInput) => {
  if (img.mime !== "image/jpeg" && img.mime !== "image/png") throw new Error(`unsupported image type ${img.mime}`);
  return `data:${img.mime};base64,${Buffer.from(img.bytes).toString("base64")}`;
};

/** The request body. Pure: the tests check every field without calling Meta. */
export function museImageRequest(referenceImages: ImageInput[], prompt: string, options: Pick<ImageOptions, "aspectRatio">, cfg: MuseImageConfig, productImage?: ImageInput) {
  if (!referenceImages.length) throw new Error("no reference photos");
  const n = referenceImages.length;
  const content = [
    { type: "input_text", text: `Reference photo${n === 1 ? "" : "s"} of the licensed person (${n}):` },
    ...referenceImages.map((r) => ({ type: "input_image", image_url: dataUrl(r) })),
    ...(productImage ? [{ type: "input_text", text: "The brand's product photo:" }, { type: "input_image", image_url: dataUrl(productImage) }] : []),
    { type: "input_text", text: referencePrompt(prompt, n, options.aspectRatio ?? "1:1", !!productImage) },
  ];
  return {
    model: cfg.model,
    input: [{ type: "message", role: "user", content }],
    store: false,
    stream: false,
    temperature: cfg.temperature,
    top_p: cfg.topP,
    max_output_tokens: cfg.maxOutputTokens,
    tools: [
      {
        type: "image_generation",
        ...MUSE_IMAGE_TOOL_SWITCHES,
        output_format: "png",
        reasoning_strength: cfg.reasoningStrength,
        size: options.aspectRatio ? MUSE_IMAGE_SIZES[options.aspectRatio] : "auto",
      },
    ],
  };
}

export type MuseImageResponse = {
  id?: string;
  status?: string;
  model?: string;
  output?: { type: string; status?: string; result?: string | null; content?: { type: string; text?: string }[]; summary?: { text?: string }[] }[];
  usage?: Record<string, unknown>;
  incomplete_details?: { reason?: string } | null;
};

/** The generated image from image_generation_call.result, or a plain reason why there is none. */
export async function museImageResult(res: MuseImageResponse): Promise<{ bytes: Uint8Array; mime: "image/png" }> {
  const item = res.output?.find((o) => o.type === "image_generation_call" && typeof o.result === "string" && o.result.length > 0);
  if (!item) {
    const said = res.output?.flatMap((o) => (o.type === "message" ? (o.content ?? []).map((c) => c.text ?? "") : [])).join(" ").trim();
    const why = [res.status && `status ${res.status}`, res.incomplete_details?.reason && `reason ${res.incomplete_details.reason}`, said && `model said: ${said.slice(0, 200)}`].filter(Boolean).join("; ");
    throw new MetaApiError(422, "no_image", `Muse Image returned no image${why ? ` (${why})` : ""}`);
  }
  const raw = Buffer.from(item.result!, "base64");
  const isPng = raw.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  // png was asked for; anything else is converted, so the label and C2PA steps always get a PNG.
  return { bytes: new Uint8Array(isPng ? raw : await sharp(raw).png().toBuffer()), mime: "image/png" };
}

async function generate(referenceImages: ImageInput[], prompt: string, options: ImageOptions, productImage?: ImageInput): Promise<GeneratedImage> {
  const cfg = museImageConfig();
  const t = Date.now();
  const res = await metaPost<MuseImageResponse>("/responses", museImageRequest(referenceImages, prompt, options, cfg, productImage), { timeoutMs: 180_000 });
  const image = await museImageResult(res);
  const model = res.model ?? cfg.model;
  return {
    ...image,
    metrics: {
      provider: "meta",
      model,
      latencyMs: Date.now() - t,
      usage: res.usage,
      cost: estimateCost("meta", cfg.model, res.usage, 1),
      settings: { reasoning_strength: cfg.reasoningStrength, temperature: cfg.temperature, top_p: cfg.topP, size: options.aspectRatio ? MUSE_IMAGE_SIZES[options.aspectRatio] : "auto" },
    },
  };
}

export const museImageGenerator: ImageGenerator = {
  provider: "meta",
  edit: (referenceImages, prompt, options) => generate(referenceImages, prompt, options),
  multiImage: (referenceImages, productImage, prompt, options) => generate(referenceImages, prompt, options, productImage),
};
