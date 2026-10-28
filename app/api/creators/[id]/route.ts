import { getCreator, publicCreator } from "@/lib/server/creators";
import { docId, HttpError } from "@/lib/server/http";
import { route } from "@/lib/server/route";

export const GET = route<{ id: string }>(async (_req, p) => {
  const c = await getCreator(docId(p.id));
  if (!c || c.status !== "live") throw new HttpError(404, "no such creator");
  return { creator: publicCreator(c) };
});
