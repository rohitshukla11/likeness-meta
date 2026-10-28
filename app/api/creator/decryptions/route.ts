import { firestore } from "@/lib/server/firebase-admin";
import { authed } from "@/lib/server/route";

/** Every time the render service opened this creator's photos. */
export const GET = authed(async (_req, me) => {
  const s = await firestore().collection("decryptions").where("creatorId", "==", me.uid).limit(200).get();
  return { decryptions: s.docs.map((d) => d.data() as { licenceId: string; renderId: string; by: string; at: number }).sort((a, b) => b.at - a.at) };
});
