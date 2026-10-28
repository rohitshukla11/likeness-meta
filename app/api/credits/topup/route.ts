import { ledger, topUp } from "@/lib/server/accounts";
import { authed } from "@/lib/server/route";

/** Demo credits only: a top-up button for the prototype, capped, recorded in the ledger. */
export const POST = authed(async (_req, me) => ({ credits: await topUp(me.uid) }));
export const GET = authed(async (_req, me) => ({ ledger: await ledger(me.uid) }));
