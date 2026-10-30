import { firestore } from "@/lib/server/firebase-admin";
import { EVAL_ACCESS_LABEL } from "@/lib/server/render-image";
import { authed } from "@/lib/server/route";

type Opening = { licenceId: string; renderId: string; by: string; label?: string; at: number };

/** Older entries' wording, shown in today's words; the stored entries are never rewritten. */
const SHOWN_AS: Record<string, string> = { "Evaluation render": EVAL_ACCESS_LABEL };
const shownLabel = (o: Opening): Opening => (o.label && SHOWN_AS[o.label] ? { ...o, label: SHOWN_AS[o.label] } : o);

/** Every time this creator's photos were opened, with a purpose label on anything that isn't a real render. Nothing is filtered out. */
export const GET = authed(async (_req, me) => {
  const s = await firestore().collection("decryptions").where("creatorId", "==", me.uid).limit(200).get();
  return { decryptions: s.docs.map((d) => shownLabel(d.data() as Opening)).sort((a, b) => b.at - a.at) };
});
