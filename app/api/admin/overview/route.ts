import { adminOverview, parseProvider, requireAdmin } from "@/lib/server/admin";
import { authed } from "@/lib/server/route";

/** Admins only: per-render steps (latency, estimated cost), totals per day and provider, blocked renders. ?days=1–30 (default 7); ?provider=meta|google|fixture (default all). */
export const GET = authed(async (req, me) => {
  requireAdmin(me);
  const q = new URL(req.url).searchParams;
  const days = Math.min(30, Math.max(1, Math.floor(Number(q.get("days") ?? 7)) || 7));
  return adminOverview(days, parseProvider(q.get("provider")));
});
