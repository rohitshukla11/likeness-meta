import { matchFrames } from "@/lib/server/creators";
import { authed, b64bytes, body } from "@/lib/server/route";

export const maxDuration = 60;

/** Compare three live frames with the channel avatar. Only the frames' hashes are kept. */
export const POST = authed(async (req, me) => {
  const b = await body<{ frames?: string[]; liveness?: { blinks: number; turnedLeft: boolean; turnedRight: boolean } }>(req);
  const frames = (b.frames ?? []).map(b64bytes);
  return matchFrames(me.uid, frames, b.liveness ?? { blinks: 0, turnedLeft: false, turnedRight: false });
});
