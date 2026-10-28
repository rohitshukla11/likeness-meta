import { firestore } from "@/lib/server/firebase-admin";
import { docId, HttpError } from "@/lib/server/http";
import { authed } from "@/lib/server/route";
import type { RenderDoc } from "@/lib/server/render-image";
import { getObject, signedUrl } from "@/lib/server/storage";

const MINUTES = 15;

/**
 * A 15-minute V4 signed URL for a render, for the brand that paid for it or the creator in it.
 * ?variant=preview: the small labelled preview, falling back to the file.
 * Locally (user credentials can't sign) the bytes come back inline instead.
 */
export const GET = authed<{ id: string }>(async (req, me, p) => {
  const s = await firestore().collection("renders").doc(docId(p.id)).get();
  const r = s.data() as RenderDoc | undefined;
  if (!r) throw new HttpError(404, "no such render");
  if (r.brandId !== me.uid && r.creatorId !== me.uid) throw new HttpError(403, "not your render");
  const preview = new URL(req.url).searchParams.get("variant") === "preview";
  const object = preview ? (r.previewObject ?? (r.type === "image" ? r.object : null)) : r.object;
  if (!object) return { url: null, mime: null };
  const mime = preview ? "image/jpeg" : r.mime;
  try {
    return { url: await signedUrl(object, MINUTES), mime, expiresAt: Date.now() + MINUTES * 60_000 };
  } catch {
    const b = await getObject(object);
    if (!b) throw new HttpError(404, "file missing");
    return { url: `data:${mime};base64,${b.toString("base64")}`, mime, expiresAt: Date.now() + MINUTES * 60_000, inline: true };
  }
});
