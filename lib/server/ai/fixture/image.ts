import "server-only";
/**
 * ImageGenerator for development only (AI_PROVIDER=fixture): returns a stored image (FIXTURE_IMAGE_PATH)
 * instead of calling a model, so the rest of the pipeline (consent gate, label, C2PA, payment, step log)
 * can be checked without a paid call. With it, the policy check is the offline stand-in in ./agent.ts. Cost 0; metrics say "fixture". Refused in production
 * (lib/server/ai/index.ts, instrumentation.ts) and by scripts/deploy-gcp.sh; never used in the demo.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { GeneratedImage, ImageGenerator, ImageInput } from "../types";

function stored(): ImageInput & { name: string } {
  const p = process.env.FIXTURE_IMAGE_PATH;
  if (!p) throw Object.assign(new Error("AI_PROVIDER=fixture needs FIXTURE_IMAGE_PATH (a JPEG or PNG on this machine)"), { status: 503 });
  const bytes = new Uint8Array(readFileSync(/*turbopackIgnore: true*/ path.resolve(/*turbopackIgnore: true*/ process.cwd(), p)));
  const png = bytes[0] === 0x89 && bytes[1] === 0x50;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!png && !jpeg) throw new Error(`FIXTURE_IMAGE_PATH is not a JPEG or PNG: ${p}`);
  return { bytes, mime: png ? "image/png" : "image/jpeg", name: path.basename(p) };
}

async function generate(): Promise<GeneratedImage> {
  const t = Date.now();
  const { name, ...image } = stored();
  return { ...image, metrics: { provider: "fixture", model: `fixture:${name}`, latencyMs: Date.now() - t, cost: { costUsd: 0, estimate: true, basis: "fixture: a stored image, no model call" } } };
}

export const fixtureImageGenerator: ImageGenerator = { provider: "fixture", edit: generate, multiImage: generate };
