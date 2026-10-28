import { authed, body } from "@/lib/server/route";
import { renderImage } from "@/lib/server/render-image";

export const maxDuration = 120;

export const POST = authed(async (req, me) => {
  const b = await body<{ licenceId: string; brief: string; aspectRatio?: "1:1" | "16:9" | "9:16" }>(req);
  return renderImage(me.uid, String(b.licenceId), String(b.brief ?? ""), b.aspectRatio);
});
