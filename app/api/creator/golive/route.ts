import { goLive, publicCreator } from "@/lib/server/creators";
import { authed, b64bytes, body } from "@/lib/server/route";

export const maxDuration = 60;

/** "Protect my photos and go live": encrypt and store the matched frames, publish, list. */
export const POST = authed(async (req, me) => {
  const b = await body<{ frames?: string[]; adult?: boolean; consent?: boolean }>(req);
  const c = await goLive(me.uid, (b.frames ?? []).map(b64bytes), { adult: !!b.adult, consent: !!b.consent });
  return { creator: publicCreator(c) };
});
