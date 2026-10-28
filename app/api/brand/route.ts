import { saveBrand } from "@/lib/server/accounts";
import { authed, body } from "@/lib/server/route";

export const POST = authed(async (req, me) => {
  const b = await body<{ name?: string; website?: string }>(req);
  return { brand: await saveBrand(me.uid, b.name ?? "", b.website ?? "") };
});
