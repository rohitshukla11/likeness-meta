import { docId } from "@/lib/server/http";
import { revoke } from "@/lib/server/licences";
import { authed } from "@/lib/server/route";

export const POST = authed<{ id: string }>(async (_req, me, p) => ({ licence: await revoke(me.uid, docId(p.id)) }));
