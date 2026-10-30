import "server-only";
/**
 * Per-request rate limits on the routes that cost money or change state: render, plan ("Write it for
 * me", the brand agent) and reset. A fixed one-minute window per user and route, counted in Firestore
 * (rateLimits/{route}:{uid}:{window}) so every Cloud Run instance shares it. Over the limit: 429,
 * RATE_LIMITED, with Retry-After. Each counter carries expiresAt for a Firestore TTL policy. These sit
 * on top of the daily render limits, which cap spend per day.
 */
import { firestore } from "./firebase-admin";
import { HttpError } from "./http";

export type LimitedRoute = "render" | "plan" | "reset";

export const WINDOW_MS = 60_000;

export const perMinute = (route: LimitedRoute): number => {
  const env = { render: "RATE_LIMIT_RENDER_PER_MIN", plan: "RATE_LIMIT_PLAN_PER_MIN", reset: "RATE_LIMIT_RESET_PER_MIN" }[route];
  const fallback = { render: 6, plan: 12, reset: 3 }[route];
  const v = Number(process.env[env] ?? fallback);
  return Number.isInteger(v) && v > 0 ? v : fallback;
};

export const windowKey = (route: LimitedRoute, uid: string, now: number) => `${route}:${uid}:${Math.floor(now / WINDOW_MS)}`;

/** Allowed or not for the request that brings the window's count to `count`; Retry-After until the window ends. Pure. */
export function rateDecision(count: number, limit: number, now: number): { allowed: boolean; retryAfter: number } {
  const windowEnd = (Math.floor(now / WINDOW_MS) + 1) * WINDOW_MS;
  return { allowed: count <= limit, retryAfter: Math.max(1, Math.ceil((windowEnd - now) / 1000)) };
}

export class RateLimited extends HttpError {
  constructor(
    route: LimitedRoute,
    limit: number,
    readonly retryAfter: number,
  ) {
    super(429, `too many ${route} requests: at most ${limit} a minute`, "RATE_LIMITED");
  }
}

/** Count this request; throw RateLimited when it is over the route's limit. */
export async function enforceRateLimit(route: LimitedRoute, uid: string, now = Date.now()): Promise<void> {
  const limit = perMinute(route);
  const ref = firestore().collection("rateLimits").doc(windowKey(route, uid, now));
  const count = await firestore().runTransaction(async (tx) => {
    const n = Number((await tx.get(ref)).data()?.count ?? 0) + 1;
    tx.set(ref, { route, uid, count: n, expiresAt: new Date((Math.floor(now / WINDOW_MS) + 1) * WINDOW_MS + 3_600_000) }, { merge: true });
    return n;
  });
  const d = rateDecision(count, limit, now);
  if (!d.allowed) throw new RateLimited(route, limit, d.retryAfter);
}
