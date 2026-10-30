import "server-only";

export const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

/**
 * Map any thrown error to a JSON response: errors with a numeric `status` keep it, a reason `code`
 * (lib/reasons.ts) goes with it, and `retryAfter` (seconds) becomes a Retry-After header.
 */
export function fail(e: unknown) {
  const status = typeof (e as { status?: unknown })?.status === "number" ? (e as { status: number }).status : 500;
  const message = e instanceof Error ? e.message : "failed";
  const code = typeof (e as { code?: unknown })?.code === "string" ? (e as { code: string }).code : undefined;
  const retryAfter = typeof (e as { retryAfter?: unknown })?.retryAfter === "number" ? Math.ceil((e as { retryAfter: number }).retryAfter) : undefined;
  if (status >= 500) console.error(JSON.stringify({ service: "api", status, ...(code ? { code } : {}), error: message.slice(0, 500) }));
  const r = json({ error: message, ...(code ? { code } : {}), ...(retryAfter ? { retryAfter } : {}) }, status);
  if (retryAfter) r.headers.set("retry-after", String(retryAfter));
  return r;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** A reason code from lib/reasons.ts, shown to the user with its next step. */
    readonly code?: string,
  ) {
    super(message);
  }
}

/** A Firestore document id we generated (or a Firebase uid): letters, digits, - and _. */
export function docId(v: string | null | undefined, name = "id"): string {
  if (!v || !/^[A-Za-z0-9_-]{6,128}$/.test(v)) throw new HttpError(400, `bad ${name}`);
  return v;
}
