import "server-only";
/**
 * Gemini on Vertex AI over REST, with the service account (no API key).
 *   POST https://aiplatform.googleapis.com/v1/projects/{project}/locations/global/publishers/google/models/{model}:generateContent
 * Models (Vertex model catalogue): gemini-nano-banana-2.1 for image generation and editing with
 * reference photos (GA, global endpoint, up to 14 input images, person generation supported), and
 * gemini-3.5-flash-lite for the prompt safety filter (GA). Errors keep Google's status and message.
 */
import { accessToken, gcp, requireProject } from "./gcp";

export const geminiModels = {
  image: () => process.env.GEMINI_IMAGE_MODEL || "gemini-nano-banana-2.1",
  filter: () => process.env.GEMINI_FILTER_MODEL || "gemini-3.5-flash-lite",
};

/** Vertex AI is usable when a project is configured (credentials are checked on first call). */
export const vertexConfigured = () => !!gcp.project();

export type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string }; thought?: boolean };
export type GeminiResponse = {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string; finishMessage?: string }[];
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
  usageMetadata?: Record<string, unknown>;
};

export class GeminiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly googleStatus: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Vertex AI uses dynamic shared quota: a 429 RESOURCE_EXHAUSTED (or a 503) can be transient, so retry
 * with backoff (5, 15, 30 s) before giving up: a new project has a small per-minute image quota.
 */
export async function generateContent(model: string, body: unknown, timeoutMs = 120_000): Promise<GeminiResponse> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await generateOnce(model, body, timeoutMs);
    } catch (e) {
      const retryable = e instanceof GeminiError && (e.httpStatus === 429 || e.httpStatus === 503);
      if (!retryable || attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, [5000, 15000, 30000][attempt]));
    }
  }
}

async function generateOnce(model: string, body: unknown, timeoutMs: number): Promise<GeminiResponse> {
  const project = requireProject();
  const url = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${model}:generateContent`;
  let r: Response;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // No answer in time: a 504 with the TIMEOUT reason code (lib/reasons.ts), not retried (the call may have run).
    if ((e as Error).name === "TimeoutError") throw Object.assign(new GeminiError(504, "DEADLINE_EXCEEDED", `Gemini ${model}: no answer in ${Math.round(timeoutMs / 1000)} s`), { code: "TIMEOUT", status: 504 });
    throw e;
  }
  const j = (await r.json().catch(() => ({}))) as GeminiResponse & { error?: { code?: number; status?: string; message?: string } };
  if (!r.ok || j.error) {
    const status = j.error?.status ?? String(r.status);
    throw new GeminiError(r.status, status, `Gemini ${model}: HTTP ${r.status} ${status}: ${j.error?.message ?? "no message"}`);
  }
  return j;
}
