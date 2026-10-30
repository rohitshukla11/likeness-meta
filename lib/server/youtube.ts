import "server-only";
/**
 * YouTube Data API v3, read-only, with the user's own OAuth access token (scope youtube.readonly),
 * used once and never stored: channels.list?part=snippet,statistics&mine=true (1 quota unit).
 * subscriberCount is rounded by YouTube to three significant figures; hiddenSubscriberCount hides it.
 */
import type { Channel } from "@/lib/model";
import { HttpError } from "./http";

type ChannelsList = {
  items?: {
    id: string;
    snippet?: { title?: string; thumbnails?: Record<string, { url: string; width?: number }> };
    statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
  }[];
  error?: { code?: number; message?: string };
};

export async function myChannel(accessToken: string): Promise<Channel> {
  const r = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await r.json().catch(() => ({}))) as ChannelsList;
  if (r.status === 401 || r.status === 403) throw new HttpError(403, `YouTube refused the request (${j.error?.message ?? r.status}). Grant "See your YouTube account" when Google asks.`);
  if (!r.ok) throw new HttpError(502, `YouTube API error ${r.status}: ${j.error?.message ?? "no message"}`);
  const c = j.items?.[0];
  if (!c) throw new HttpError(404, "This Google account has no YouTube channel. Create one, then connect again.");
  const thumbs = c.snippet?.thumbnails ?? {};
  const best = thumbs.high ?? thumbs.medium ?? thumbs.default;
  if (!best?.url) throw new HttpError(422, "Your channel has no avatar.");
  return {
    channelId: c.id,
    title: c.snippet?.title ?? "YouTube channel",
    // Channel avatars are served by size: ask for 800 px for the face check.
    avatarUrl: best.url.replace(/=s\d+(-[^/]*)?$/, "=s800-c-k-c0x00ffffff-no-rj"),
    subscriberCount: c.statistics?.hiddenSubscriberCount ? null : Number(c.statistics?.subscriberCount ?? 0),
    connectedAt: Date.now(),
  };
}

export async function fetchAvatar(url: string): Promise<Uint8Array> {
  if (!/^https:\/\/yt3\.(ggpht|googleusercontent)\.com\//.test(url)) throw new HttpError(400, "unexpected avatar host");
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new HttpError(502, `could not download the channel avatar (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}
