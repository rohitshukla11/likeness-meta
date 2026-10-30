import { balance, ensureUser, getBrand, getUser, setRole } from "@/lib/server/accounts";
import { getCreator, publicCreator } from "@/lib/server/creators";
import { isAdmin } from "@/lib/server/admin";
import { supportedAspects } from "@/lib/server/ai";
import { isJudge, judgeRegistry } from "@/lib/server/demo";
import { authed, body } from "@/lib/server/route";
import type { Role } from "@/lib/model";

/** Who I am: role, creator onboarding state, brand profile, demo-credit balance. */
export const GET = authed(async (_req, me) => {
  const user = (await getUser(me.uid)) ?? (await ensureUser(me.uid, me.name, me.email));
  const [creator, brand, credits, judges] = await Promise.all([getCreator(me.uid), getBrand(me.uid), balance(me.uid), judgeRegistry()]);
  const c = creator as (typeof creator & { pendingFrames?: string[] | null }) | null;
  return {
    user,
    creator: c ? { ...publicCreator(c), faceMatched: !!c.pendingFrames || c.status === "live", liveness: c.liveness ?? null } : null,
    brand,
    credits,
    /** A seeded judge account: sees "Reset demo". */
    judge: isJudge(judges, me.uid),
    /** Sees the admin view (ADMIN_UIDS / ADMIN_EMAILS). */
    admin: isAdmin(me),
    /** The image shapes this server's AI provider can make (only 1:1 with Meta's image model for now). */
    aspects: supportedAspects(),
  };
});

export const POST = authed(async (req, me) => {
  const { role } = await body<{ role: Role }>(req);
  await ensureUser(me.uid, me.name, me.email);
  await setRole(me.uid, role);
  return { ok: true, role };
});
