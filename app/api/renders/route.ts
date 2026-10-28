import { firestore } from "@/lib/server/firebase-admin";
import { authed } from "@/lib/server/route";
import type { LicenceDoc } from "@/lib/model";
import { publicRender, type RenderDoc } from "@/lib/server/render-image";

/** Renders I paid for (brand) or that used my likeness (creator), with each licence's names and use. */
export const GET = authed(async (_req, me) => {
  const db = firestore();
  const [b, c] = await Promise.all([db.collection("renders").where("brandId", "==", me.uid).limit(100).get(), db.collection("renders").where("creatorId", "==", me.uid).limit(100).get()]);
  const all = [...b.docs, ...c.docs].map((d) => d.data() as RenderDoc);
  const ids = [...new Set(all.map((r) => r.licenceId))];
  const lic = ids.length ? await db.getAll(...ids.map((id) => db.collection("licences").doc(id))) : [];
  const byId = new Map(lic.map((s) => [s.id, s.data() as LicenceDoc | undefined]));
  const shape = (r: RenderDoc) => {
    const l = byId.get(r.licenceId);
    return { ...publicRender(r), creatorName: l?.creatorName ?? "", brandName: l?.brandName ?? "", use: l?.use ?? "" };
  };
  const newest = (x: { createdAt: number }, y: { createdAt: number }) => y.createdAt - x.createdAt;
  return { asBrand: b.docs.map((d) => shape(d.data() as RenderDoc)).sort(newest), asCreator: c.docs.map((d) => shape(d.data() as RenderDoc)).sort(newest) };
});
