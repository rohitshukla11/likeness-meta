import { docId } from "@/lib/server/http";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { renderAlternative } from "@/lib/server/render-image";
import { authed, body } from "@/lib/server/route";

// An alternative is a full render: as long as /api/render/image.
export const maxDuration = 300;

/** "Ask for an alternative" on an image the output review flagged: one per image, rendered and charged as a new render. */
export const POST = authed(async (req, me) => {
  await enforceRateLimit("render", me.uid);
  const b = await body<{ renderId?: string; requestId?: string }>(req);
  return renderAlternative(me.uid, docId(String(b.renderId ?? ""), "renderId"), docId(String(b.requestId ?? ""), "requestId"));
});
