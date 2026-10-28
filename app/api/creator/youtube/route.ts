import { connectChannel, publicCreator } from "@/lib/server/creators";
import { HttpError } from "@/lib/server/http";
import { authed, body } from "@/lib/server/route";

export const maxDuration = 60;

/** Connect the caller's own YouTube channel. The OAuth access token is used once and not stored. */
export const POST = authed(async (req, me) => {
  const { accessToken } = await body<{ accessToken?: string }>(req);
  if (!accessToken) throw new HttpError(400, "no YouTube access token");
  return { creator: publicCreator(await connectChannel(me.uid, accessToken)) };
});
