import { resetDemo } from "@/lib/server/demo";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { authed } from "@/lib/server/route";

/** "Reset demo": the judge accounts only. Restores the judge licence's render count and the judge brand's credits. */
export const POST = authed(async (_req, me) => {
  await enforceRateLimit("reset", me.uid);
  return resetDemo(me.uid);
});
