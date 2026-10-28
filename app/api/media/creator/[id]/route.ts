import { docId } from "@/lib/server/http";
import { getObject } from "@/lib/server/storage";

/** A live creator's public photo (512 px, labelled), streamed from the private bucket. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const b = await getObject(`public/${docId((await ctx.params).id)}.jpg`);
    if (!b) return new Response("not found", { status: 404 });
    return new Response(new Uint8Array(b), { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=300" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
