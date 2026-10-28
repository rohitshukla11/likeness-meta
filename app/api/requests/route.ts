import { fileRequest } from "@/lib/server/licences";
import { authed, body } from "@/lib/server/route";

export const POST = authed(async (req, me) => {
  const b = await body<{ creatorId: string; use: string; days: number; maxRenders: number; brief: string }>(req);
  return { request: await fileRequest(me.uid, b) };
});
