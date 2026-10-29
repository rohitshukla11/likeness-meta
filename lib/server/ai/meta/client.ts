import "server-only";
/**
 * The Meta Model API over REST (https://dev.meta.ai/docs): POST JSON with "Authorization: Bearer
 * MODEL_API_KEY". Request timeouts; retries on 429 and 5xx with exponential backoff and jitter (500 ms,
 * doubled each time, at least the server's Retry-After), as Meta's rate-limit guide recommends. Errors
 * keep the HTTP status and Meta's message. Request and response bodies are never logged: they carry
 * the creator's photos. A paid script's spending cap (--max-usd, ../budget.ts) is checked before every call.
 */
import { record, reserve } from "../budget";

export const metaApiBase = () => (process.env.META_API_BASE || "https://api.meta.ai/v1").replace(/\/+$/, "");
export const metaConfigured = () => !!process.env.MODEL_API_KEY;

export class MetaApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export type PostOptions = { timeoutMs?: number; retries?: number; sleep?: (ms: number) => Promise<void> };

export async function metaPost<T>(path: string, body: unknown, opts: PostOptions = {}): Promise<T> {
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new MetaApiError(503, "not_configured", "MODEL_API_KEY is not set");
  const est = reserve(body);
  try {
    const out = await post<T>(key, path, body, opts);
    record(body, est, { usage: (out as { usage?: Record<string, unknown> }).usage });
    return out;
  } catch (e) {
    record(body, est, { refused: e instanceof MetaApiError && e.httpStatus >= 400 && e.httpStatus < 500 });
    throw e;
  }
}

async function post<T>(key: string, path: string, body: unknown, opts: PostOptions): Promise<T> {
  const { timeoutMs = 120_000, retries = 3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = opts;
  for (let attempt = 0; ; attempt++) {
    let r: Response;
    try {
      r = await fetch(`${metaApiBase()}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const timedOut = (e as Error).name === "TimeoutError";
      if (attempt >= retries) throw new MetaApiError(timedOut ? 504 : 502, timedOut ? "timeout" : "network", `Meta ${path}: ${timedOut ? `no answer in ${Math.round(timeoutMs / 1000)} s` : (e as Error).message}`);
      await sleep(backoff(attempt, null));
      continue;
    }
    const j = (await r.json().catch(() => ({}))) as T & { error?: { message?: string; code?: string; type?: string } };
    if (r.ok && !j.error) return j;
    const code = String(j.error?.code ?? j.error?.type ?? r.status);
    if (RETRYABLE.has(r.status) && attempt < retries) {
      await sleep(backoff(attempt, r.headers.get("retry-after")));
      continue;
    }
    throw new MetaApiError(r.status, code, `Meta ${path}: HTTP ${r.status} ${code}: ${j.error?.message ?? "no message"}`);
  }
}

/**
 * A streamed (server-sent events) call: the same auth and retries as metaPost until the response starts,
 * then the whole stream read as text within the timeout. The caller parses it. Never logged.
 */
export async function metaStream(path: string, body: unknown, opts: PostOptions = {}): Promise<string> {
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new MetaApiError(503, "not_configured", "MODEL_API_KEY is not set");
  const est = reserve(body);
  try {
    const out = await stream(key, path, body, opts);
    record(body, est, {});
    return out;
  } catch (e) {
    record(body, est, { refused: e instanceof MetaApiError && e.httpStatus >= 400 && e.httpStatus < 500 });
    throw e;
  }
}

async function stream(key: string, path: string, body: unknown, opts: PostOptions): Promise<string> {
  const { timeoutMs = 60_000, retries = 3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = opts;
  for (let attempt = 0; ; attempt++) {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const r = await fetch(`${metaApiBase()}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal,
      });
      if (r.ok) return await r.text();
      const j = (await r.json().catch(() => ({}))) as { error?: { message?: string; code?: string; type?: string } };
      const code = String(j.error?.code ?? j.error?.type ?? r.status);
      if (RETRYABLE.has(r.status) && attempt < retries) {
        await sleep(backoff(attempt, r.headers.get("retry-after")));
        continue;
      }
      throw new MetaApiError(r.status, code, `Meta ${path}: HTTP ${r.status} ${code}: ${j.error?.message ?? "no message"}`);
    } catch (e) {
      if (e instanceof MetaApiError) throw e;
      const timedOut = (e as Error).name === "TimeoutError" || signal.aborted;
      if (timedOut || attempt >= retries) throw new MetaApiError(timedOut ? 504 : 502, timedOut ? "timeout" : "network", `Meta ${path}: ${timedOut ? `no complete stream in ${Math.round(timeoutMs / 1000)} s` : (e as Error).message}`);
      await sleep(backoff(attempt, null));
    }
  }
}

/** 500 ms doubled per attempt, plus up to 250 ms of jitter, and never less than Retry-After (seconds). */
export function backoff(attempt: number, retryAfter: string | null): number {
  const base = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
  const ra = retryAfter !== null && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : 0;
  return Math.max(base, ra);
}
