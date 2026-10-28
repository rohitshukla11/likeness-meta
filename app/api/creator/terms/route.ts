import type { Terms } from "@/lib/model";
import { setListed, setTerms } from "@/lib/server/creators";
import { authed, body } from "@/lib/server/route";

export const POST = authed(async (req, me) => {
  const b = await body<{ terms?: Terms; listed?: boolean }>(req);
  if (typeof b.listed === "boolean") await setListed(me.uid, b.listed);
  return b.terms ? { terms: await setTerms(me.uid, b.terms) } : { ok: true };
});
