import { listFor } from "@/lib/server/licences";
import { authed } from "@/lib/server/route";

/** My requests and licences, as creator and as brand. */
export const GET = authed(async (_req, me) => {
  const [asCreator, asBrand] = await Promise.all([listFor("creatorId", me.uid), listFor("brandId", me.uid)]);
  return { asCreator, asBrand };
});
