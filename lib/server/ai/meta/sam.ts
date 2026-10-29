import "server-only";
/**
 * PersonSegmenter on Meta SAM 3.1 (sam-3.1) over the Responses API, as in the Meta console's "Get code":
 * one user message with the concept "person" and the image, stream: true, metadata.mask_encoding
 * "one_bit". The image goes as a base64 data URL (the SAM docs accept one for input_image), so nothing
 * is uploaded to the Files API and nothing needs deleting. store isn't sent: the SAM docs don't list it.
 *
 * The stream is read strictly (./samFormat.ts): count and boxes (normalised to the image), and each
 * person's mask decoded in memory. A failed or incomplete stream, a parse error, an unknown token, an
 * image size that differs from the one sent, or a timeout throws, and the consent gate blocks with
 * GATE_ERROR. Price: $2.50 per 1,000 images (lib/server/ai/pricing.ts).
 */
import sharp from "sharp";
import { estimateCost } from "../pricing";
import type { ImageInput, Mask, PeopleDetection, PersonSegmenter } from "../types";
import { metaStream } from "./client";
import { decodeOneBit, readImageStream, SamFormatError } from "./samFormat";

export const samModel = () => process.env.SAM_MODEL || "sam-3.1";

/** The request body. Pure: the tests check it without calling Meta. */
export function samRequest(image: ImageInput) {
  if (image.mime !== "image/jpeg" && image.mime !== "image/png") throw new Error(`unsupported image type ${image.mime}`);
  return {
    model: samModel(),
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "person" },
          { type: "input_image", image_url: `data:${image.mime};base64,${Buffer.from(image.bytes).toString("base64")}` },
        ],
      },
    ],
    stream: true,
    metadata: { mask_encoding: "one_bit" },
  };
}

/** The image's displayed size (after any EXIF rotation), which SAM reports as w and h. */
async function displayedSize(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  const m = await sharp(bytes).metadata();
  const swap = (m.orientation ?? 1) >= 5;
  return swap ? { width: m.height ?? 0, height: m.width ?? 0 } : { width: m.width ?? 0, height: m.height ?? 0 };
}

/** The stream → people. `raw` is the whole server-sent-events text. Exported for the tests and the first-call check. */
export async function readPeople(raw: string, image: ImageInput): Promise<Omit<PeopleDetection, "metrics">> {
  const frame = readImageStream(raw);
  if (!frame) return { count: 0, boxes: [], masks: [] };
  const size = await displayedSize(image.bytes);
  const boxes: PeopleDetection["boxes"] = [];
  const masks: Mask[] = [];
  for (const r of frame.records) {
    if (r.box.w !== size.width || r.box.h !== size.height) throw new SamFormatError(`SAM reported a ${r.box.w}×${r.box.h} image; ${size.width}×${size.height} was sent`);
    const box = { x: r.box.x1 / r.box.w, y: r.box.y1 / r.box.h, w: (r.box.x2 - r.box.x1) / r.box.w, h: (r.box.y2 - r.box.y1) / r.box.h };
    // SAM gives a confidence only when asked (include_confidence); without it, a returned person counts fully.
    boxes.push({ ...box, score: r.box.c ?? 1 });
    masks.push({ width: r.mask.width, height: r.mask.height, bits: decodeOneBit(r.mask.payload, r.mask.width, r.mask.height), box });
  }
  return { count: frame.records.length, boxes, masks };
}

/** Detect people; `onRaw` receives the raw stream (used once, to save its shape with payloads cut short). */
export async function samDetect(image: ImageInput, opts: { onRaw?: (raw: string) => void } = {}): Promise<PeopleDetection> {
  const t = Date.now();
  const raw = await metaStream("/responses", samRequest(image), { timeoutMs: 60_000 });
  opts.onRaw?.(raw);
  const people = await readPeople(raw, image);
  return { ...people, metrics: { provider: "meta", model: samModel(), latencyMs: Date.now() - t, cost: estimateCost("meta", "sam-3.1", undefined, 1) } };
}

export const samSegmenter: PersonSegmenter = { detectPeople: (image) => samDetect(image) };
