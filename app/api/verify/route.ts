import { HttpError } from "@/lib/server/http";
import { route } from "@/lib/server/route";
import { verifyFile, verifyHash } from "@/lib/server/verify";

export const maxDuration = 60;

/** Anyone can check a file: multipart field "file". Nothing is stored. */
export const POST = route(async (req) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "attach a file");
  if (file.size > 60 * 1024 * 1024) throw new HttpError(413, "file is larger than 60 MB");
  const mime = file.type || (file.name.endsWith(".png") ? "image/png" : "image/jpeg");
  return verifyFile(new Uint8Array(await file.arrayBuffer()), mime);
});

/** Check a render by its receipt key: GET /api/verify?sha=<sha256 of the file>. */
export const GET = route(async (req) => verifyHash(String(new URL(req.url).searchParams.get("sha") ?? "")));
