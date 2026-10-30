import type { Aspect } from "@/lib/creative";
import { authed, body } from "@/lib/server/route";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { renderImage } from "@/lib/server/render-image";

// Muse Image is given up to 3 minutes (lib/server/ai/meta/image.ts), plus retries and the other steps.
export const maxDuration = 300;

/** Make one image ad. With requestId (a UUID per click) a repeat returns the first result, never a second charge. */
export const POST = authed(async (req, me) => {
  await enforceRateLimit("render", me.uid);
  const b = await body<{ licenceId: string; brief: string; aspectRatio?: Aspect; requestId?: string }>(req);
  return renderImage(me.uid, String(b.licenceId), String(b.brief ?? ""), b.aspectRatio, b.requestId ? { requestId: String(b.requestId) } : {});
});
