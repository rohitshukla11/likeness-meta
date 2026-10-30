import { isAdmin } from "@/lib/server/admin";
import { requireUser } from "@/lib/server/authn";
import { route } from "@/lib/server/route";
import { statusChecks } from "@/lib/server/status";

/** Service health: everyone gets the overall ok/failed; admins also get each check's detail. */
export const GET = route(async (req) => {
  const checks = await statusChecks();
  const ok = checks.every((c) => c.ok);
  const admin = req.headers.has("authorization") ? await requireUser(req).then(isAdmin, () => false) : false;
  return admin ? { service: "assent", ok, checks } : { service: "assent", ok };
});
