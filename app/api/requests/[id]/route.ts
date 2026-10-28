import { docId } from "@/lib/server/http";
import { decide } from "@/lib/server/licences";
import { authed, body } from "@/lib/server/route";

/** The creator approves or declines. */
export const POST = authed<{ id: string }>(async (req, me, p) => {
  const { approve } = await body<{ approve?: boolean }>(req);
  return decide(me.uid, docId(p.id), !!approve);
});
