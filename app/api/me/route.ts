import { balance, ensureUser, getBrand, getUser, setRole } from "@/lib/server/accounts";
import { getCreator, publicCreator } from "@/lib/server/creators";
import { authed, body } from "@/lib/server/route";
import type { Role } from "@/lib/model";

/** Who I am: role, creator onboarding state, brand profile, demo-credit balance. */
export const GET = authed(async (_req, me) => {
  const user = (await getUser(me.uid)) ?? (await ensureUser(me.uid, me.name, me.email));
  const [creator, brand, credits] = await Promise.all([getCreator(me.uid), getBrand(me.uid), balance(me.uid)]);
  const c = creator as (typeof creator & { pendingFrames?: string[] | null }) | null;
  return {
    user,
    creator: c ? { ...publicCreator(c), faceMatched: !!c.pendingFrames || c.status === "live", liveness: c.liveness ?? null } : null,
    brand,
    credits,
  };
});

export const POST = authed(async (req, me) => {
  const { role } = await body<{ role: Role }>(req);
  await ensureUser(me.uid, me.name, me.email);
  await setRole(me.uid, role);
  return { ok: true, role };
});
