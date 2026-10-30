import { judgeRegistryCached } from "@/lib/server/demo";
import { firestore } from "@/lib/server/firebase-admin";
import { authed } from "@/lib/server/route";
import type { LicenceDoc } from "@/lib/model";
import { blockedReason, isFixtureRecord, publicRender, type BlockedRenderDoc, type RenderDoc } from "@/lib/server/render-image";

/**
 * Renders I paid for (brand) or that used my likeness (creator), with each licence's names and use;
 * and images that were made but blocked (never delivered, never charged), for the same two parties.
 * Development renders (AI_PROVIDER=fixture), delivered or blocked, never appear here; the eval brand's renders
 * (automated test runs) never appear in the creator's lists. The admin view lists both.
 */
export const GET = authed(async (_req, me) => {
  const db = firestore();
  const mine = (c: string, field: "brandId" | "creatorId") => db.collection(c).where(field, "==", me.uid).limit(100).get();
  const [b, c, bb, bc, judges] = await Promise.all([mine("renders", "brandId"), mine("renders", "creatorId"), mine("blockedRenders", "brandId"), mine("blockedRenders", "creatorId"), judgeRegistryCached()]);
  const shown = <T extends { fixture?: true; model: string }>(s: FirebaseFirestore.QuerySnapshot) => s.docs.map((d) => d.data() as T).filter((r) => !isFixtureRecord(r));
  // By the flag, or for records made before it, by the eval brand's id.
  const notEval = (r: { evalRun?: true; brandId: string }) => !r.evalRun && r.brandId !== judges?.evalBrandUid;
  const [asBrandDocs, asCreatorDocs] = [shown<RenderDoc>(b), shown<RenderDoc>(c).filter(notEval)];
  const [blockedBrandDocs, blockedCreatorDocs] = [shown<BlockedRenderDoc>(bb), shown<BlockedRenderDoc>(bc).filter(notEval)];
  const ids = [...new Set([...asBrandDocs, ...asCreatorDocs, ...blockedBrandDocs, ...blockedCreatorDocs].map((r) => r.licenceId))];
  const lic = ids.length ? await db.getAll(...ids.map((id) => db.collection("licences").doc(id))) : [];
  const byId = new Map(lic.map((s) => [s.id, s.data() as LicenceDoc | undefined]));
  const names = (licenceId: string) => {
    const l = byId.get(licenceId);
    return { creatorName: l?.creatorName ?? "", brandName: l?.brandName ?? "", use: l?.use ?? "" };
  };
  const shape = (r: RenderDoc) => ({ ...publicRender(r), ...names(r.licenceId) });
  // Text and numbers only: the blocked image itself was deleted when it was blocked.
  const blocked = (r: BlockedRenderDoc) => ({ id: r.id, licenceId: r.licenceId, createdAt: r.createdAt, brief: r.brief, blockedBy: r.blockedBy ?? "consent", ...blockedReason(r), ...names(r.licenceId) });
  const newest = (x: { createdAt: number }, y: { createdAt: number }) => y.createdAt - x.createdAt;
  return {
    asBrand: asBrandDocs.map(shape).sort(newest),
    asCreator: asCreatorDocs.map(shape).sort(newest),
    blockedAsBrand: blockedBrandDocs.map(blocked).sort(newest),
    blockedAsCreator: blockedCreatorDocs.map(blocked).sort(newest),
  };
});
