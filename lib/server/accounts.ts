import "server-only";
/** Roles, brand profiles and the demo-credit ledger. Credits are demo money, labelled so everywhere. */
import { DEMO_TOPUP, type Role } from "@/lib/model";
import { firestore } from "./firebase-admin";
import { HttpError } from "./http";

const db = () => firestore();

export type UserDoc = { uid: string; role: Role | null; name: string | null; email: string | null; createdAt: number };
export type BrandDoc = { uid: string; name: string; website: string; createdAt: number; updatedAt: number };

export async function getUser(uid: string): Promise<UserDoc | null> {
  const s = await db().collection("users").doc(uid).get();
  return s.exists ? (s.data() as UserDoc) : null;
}

export async function ensureUser(uid: string, name: string | null, email: string | null): Promise<UserDoc> {
  const ref = db().collection("users").doc(uid);
  const s = await ref.get();
  if (s.exists) return s.data() as UserDoc;
  const u: UserDoc = { uid, role: null, name, email, createdAt: Date.now() };
  await ref.set(u);
  return u;
}

export async function setRole(uid: string, role: Role) {
  if (role !== "creator" && role !== "brand") throw new HttpError(400, "role must be creator or brand");
  await db().collection("users").doc(uid).set({ role }, { merge: true });
}

export async function getBrand(uid: string): Promise<BrandDoc | null> {
  const s = await db().collection("brands").doc(uid).get();
  return s.exists ? (s.data() as BrandDoc) : null;
}

export async function saveBrand(uid: string, name: string, website: string): Promise<BrandDoc> {
  name = name.trim();
  website = website.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (name.length < 2 || name.length > 60) throw new HttpError(400, "brand name must be 2 to 60 characters");
  if (website && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(website)) throw new HttpError(400, "website should look like example.com");
  const ref = db().collection("brands").doc(uid);
  const prev = await ref.get();
  const b: BrandDoc = { uid, name, website, createdAt: prev.exists ? (prev.data() as BrandDoc).createdAt : Date.now(), updatedAt: Date.now() };
  await ref.set(b);
  return b;
}

export async function balance(uid: string): Promise<number> {
  const s = await db().collection("credits").doc(uid).get();
  return s.exists ? Number(s.data()!.balance ?? 0) : 0;
}

/** One demo top-up per account (2,000 demo credits), so a public prototype can't be drained. */
export async function topUp(uid: string): Promise<number> {
  return db().runTransaction(async (tx) => {
    const ref = db().collection("credits").doc(uid);
    const done = await tx.get(db().collection("ledger").where("uid", "==", uid).where("reason", "==", "demo top-up").limit(1));
    if (!done.empty) throw new HttpError(409, `You've already had your one demo top-up of ${DEMO_TOPUP.toLocaleString("en-US")} credits. That's enough for several image ads.`);
    const cur = Number((await tx.get(ref)).data()?.balance ?? 0);
    tx.set(ref, { uid, balance: cur + DEMO_TOPUP, updatedAt: Date.now() }, { merge: true });
    tx.create(db().collection("ledger").doc(), { uid, delta: DEMO_TOPUP, reason: "demo top-up", at: Date.now() });
    return cur + DEMO_TOPUP;
  });
}

export async function ledger(uid: string, limit = 50) {
  const s = await db().collection("ledger").where("uid", "==", uid).limit(500).get();
  return s.docs
    .map((d) => ({ id: d.id, ...(d.data() as { delta: number; reason: string; at: number; renderId?: string; licenceId?: string }) }))
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}
