import "server-only";
/** Licence requests, the creator's decision, licences and revocation. */
import { randomBytes } from "node:crypto";
import { autoApproves, licenceStatus, type LicenceDoc, type RequestDoc } from "@/lib/model";
import { getBrand } from "./accounts";
import { getCreator } from "./creators";
import { firestore } from "./firebase-admin";
import { HttpError } from "./http";

const db = () => firestore();
const newId = () => randomBytes(12).toString("base64url");

export async function fileRequest(brandUid: string, input: { creatorId: string; use: string; days: number; maxRenders: number; brief: string }): Promise<RequestDoc> {
  const brand = await getBrand(brandUid);
  if (!brand) throw new HttpError(409, "set up your brand profile first");
  const c = await getCreator(input.creatorId);
  if (!c || c.status !== "live" || !c.listed || !c.terms) throw new HttpError(404, "this creator isn't accepting licences");
  if (c.uid === brandUid) throw new HttpError(400, "you can't license your own likeness");
  if (!c.terms.uses.includes(input.use)) throw new HttpError(400, "this creator doesn't allow that use");
  const days = Math.floor(Number(input.days));
  if (!(days >= 1 && days <= c.terms.maxDays)) throw new HttpError(400, `duration must be 1 to ${c.terms.maxDays} days`);
  const maxRenders = Math.floor(Number(input.maxRenders));
  if (!(maxRenders >= 1 && maxRenders <= c.terms.maxRendersPerLicence)) throw new HttpError(400, `renders must be 1 to ${c.terms.maxRendersPerLicence}`);
  const brief = String(input.brief ?? "").trim();
  if (brief.length < 10 || brief.length > 600) throw new HttpError(400, "describe the campaign in 10 to 600 characters");
  const r: RequestDoc = { id: newId(), brandId: brandUid, brandName: brand.name, creatorId: c.uid, use: input.use, days, maxRenders, brief, state: "pending", createdAt: Date.now() };
  await db().collection("requests").doc(r.id).set(r);
  // A synthetic demo creator approves at once; the terms were checked above, like any request.
  if (autoApproves(c)) return (await decide(c.uid, r.id, true, { auto: true })).request;
  return r;
}

export async function decide(creatorUid: string, requestId: string, approve: boolean, opts: { auto?: boolean } = {}): Promise<{ request: RequestDoc; licence?: LicenceDoc }> {
  return db().runTransaction(async (tx) => {
    const ref = db().collection("requests").doc(requestId);
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpError(404, "no such request");
    const r = s.data() as RequestDoc;
    if (r.creatorId !== creatorUid) throw new HttpError(403, "only the creator can decide this request");
    if (r.state !== "pending") throw new HttpError(409, `request already ${r.state}`);
    const cs = await tx.get(db().collection("creators").doc(creatorUid));
    const c = cs.data() as { displayName: string; terms?: { pricePerImage: number } } | undefined;
    if (!approve) {
      tx.update(ref, { state: "declined", decidedAt: Date.now() });
      return { request: { ...r, state: "declined" as const } };
    }
    if (!c?.terms) throw new HttpError(409, "set your terms first");
    const now = Date.now();
    const licence: LicenceDoc = {
      id: newId(),
      requestId,
      brandId: r.brandId,
      brandName: r.brandName,
      creatorId: creatorUid,
      creatorName: c.displayName,
      use: r.use,
      start: now,
      end: now + r.days * 86_400_000,
      maxRenders: r.maxRenders,
      renderCount: 0,
      pricePerImage: c.terms.pricePerImage,
      createdAt: now,
      ...(opts.auto ? { autoApproved: true } : {}),
    };
    tx.create(db().collection("licences").doc(licence.id), licence);
    tx.update(ref, { state: "approved", decidedAt: now, licenceId: licence.id, ...(opts.auto ? { autoApproved: true } : {}) });
    return { request: { ...r, state: "approved" as const, licenceId: licence.id, ...(opts.auto ? { autoApproved: true } : {}) }, licence };
  });
}

export async function revoke(creatorUid: string, licenceId: string): Promise<LicenceDoc> {
  return db().runTransaction(async (tx) => {
    const ref = db().collection("licences").doc(licenceId);
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpError(404, "no such licence");
    const l = s.data() as LicenceDoc;
    if (l.creatorId !== creatorUid) throw new HttpError(403, "only the creator can revoke this licence");
    if (l.revokedAt) return l;
    const revokedAt = Date.now();
    tx.update(ref, { revokedAt });
    tx.create(db().collection("revocations").doc(), { licenceId, creatorId: creatorUid, brandId: l.brandId, at: revokedAt });
    return { ...l, revokedAt };
  });
}

export async function getLicence(id: string): Promise<LicenceDoc | null> {
  const s = await db().collection("licences").doc(id).get();
  return s.exists ? (s.data() as LicenceDoc) : null;
}

const withStatus = (l: LicenceDoc) => ({ ...l, status: licenceStatus(l) });

export async function listFor(field: "creatorId" | "brandId", uid: string) {
  // Equality filter only, sorted here: no composite index needed on a fresh database.
  const [req, lic] = await Promise.all([db().collection("requests").where(field, "==", uid).limit(200).get(), db().collection("licences").where(field, "==", uid).limit(200).get()]);
  const newest = <T extends { createdAt: number }>(a: T, b: T) => b.createdAt - a.createdAt;
  return {
    requests: req.docs.map((d) => d.data() as RequestDoc).sort(newest),
    licences: lic.docs.map((d) => withStatus(d.data() as LicenceDoc)).sort(newest),
  };
}
