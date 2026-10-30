import "server-only";
/**
 * Creator onboarding, saved server-side so it can be resumed:
 *   1. connectChannel: the user's own YouTube channel (proves the account is theirs); its avatar
 *      must show a face.
 *   2. matchFrames: three live frames (front, slight left, slight right) from the in-browser
 *      liveness check, compared with the channel avatar by the local face matcher (YuNet + AuraFace).
 *      Only the frames' sha256 are kept at this step; no image is stored.
 *   3. goLive: the same frames again (hashes must match), the self-declared 18+ and the consent text;
 *      the frames are encrypted (KMS envelope) and stored, the front frame becomes the public photo,
 *      default terms are applied and the creator is listed.
 */
import { createHash } from "node:crypto";
import { CONSENT_TEXT, defaultTerms, type CreatorDoc, type Terms } from "@/lib/model";
import { CATEGORIES } from "@/lib/categories";
import { compareFaces, FaceMatchError, facesIn } from "./facematch";
import { firestore } from "./firebase-admin";
import { HttpError } from "./http";
import { publicPhoto } from "./label";
import { putObject } from "./storage";
import { sealFrames } from "./vault";
import { fetchAvatar, myChannel } from "./youtube";

const creators = () => firestore().collection("creators");
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
export const avatarThreshold = () => Number(process.env.FACE_MATCH_THRESHOLD ?? 0.5);

export async function getCreator(uid: string): Promise<CreatorDoc | null> {
  const s = await creators().doc(uid).get();
  return s.exists ? (s.data() as CreatorDoc) : null;
}

export async function connectChannel(uid: string, accessToken: string): Promise<CreatorDoc> {
  const channel = await myChannel(accessToken);
  const taken = await creators().where("channel.channelId", "==", channel.channelId).limit(2).get();
  if (taken.docs.some((d) => d.id !== uid)) throw new HttpError(409, "This YouTube channel is already connected to another Assent account.");
  const avatar = await fetchAvatar(channel.avatarUrl);
  const faces = await facesIn(avatar).catch((e: Error) => {
    throw new HttpError(503, `face check unavailable: ${e.message}`);
  });
  if (faces.count === 0 || faces.best < 0.8)
    throw new HttpError(422, "Your channel avatar doesn't show a clear face, so we can't match it to you. Set a photo of yourself as your YouTube avatar, then connect again.");
  if (faces.count > 1) throw new HttpError(422, "Your channel avatar shows more than one face. Use a photo of just you, then connect again.");
  const now = Date.now();
  const prev = await getCreator(uid);
  const doc: CreatorDoc = {
    ...(prev ?? { uid, status: "draft", listed: false, createdAt: now }),
    uid,
    displayName: channel.title,
    channel,
    updatedAt: now,
  } as CreatorDoc;
  await creators().doc(uid).set(doc);
  return doc;
}

export async function matchFrames(
  uid: string,
  frames: Uint8Array[],
  liveness: { blinks: number; turnedLeft: boolean; turnedRight: boolean },
): Promise<{ ok: boolean; score: number; threshold: number; perFrame: number[] }> {
  const c = await getCreator(uid);
  if (!c?.channel) throw new HttpError(409, "connect your YouTube channel first");
  if (frames.length !== 3) throw new HttpError(400, "send exactly three frames: front, slight left, slight right");
  if (liveness.blinks < 1 || !liveness.turnedLeft || !liveness.turnedRight) throw new HttpError(422, "The liveness check wasn't completed: blink, then turn slightly left and right.");
  const avatar = await fetchAvatar(c.channel.avatarUrl);
  const perFrame: number[] = [];
  for (const f of frames) {
    try {
      perFrame.push(await compareFaces(f, avatar));
    } catch (e) {
      if (e instanceof FaceMatchError) throw new HttpError(e.status, `${e.message}. Try again in even light, with only your face in view.`);
      throw e;
    }
  }
  const threshold = avatarThreshold();
  const score = Math.max(...perFrame);
  const ok = score >= threshold;
  await creators()
    .doc(uid)
    .update({
      faceMatch: { score, threshold, framesMatched: perFrame.filter((s) => s >= threshold).length, at: Date.now() },
      liveness: { ...liveness, method: "mediapipe-face-landmarker", at: Date.now() },
      pendingFrames: ok ? frames.map(sha256) : null,
      updatedAt: Date.now(),
    });
  return { ok, score, threshold, perFrame };
}

export async function goLive(uid: string, frames: Uint8Array[], answers: { adult: boolean; consent: boolean }): Promise<CreatorDoc> {
  const snap = await creators().doc(uid).get();
  const c = snap.data() as (CreatorDoc & { pendingFrames?: string[] | null }) | undefined;
  if (!c?.channel) throw new HttpError(409, "connect your YouTube channel first");
  if (!c.faceMatch || c.faceMatch.score < c.faceMatch.threshold || !c.pendingFrames) throw new HttpError(409, "match your live face to your channel first");
  if (!answers.adult) throw new HttpError(422, "You must confirm you are 18 or older.");
  if (!answers.consent) throw new HttpError(422, "You must agree to the licensing terms to go live.");
  if (frames.length !== 3 || frames.map(sha256).join() !== c.pendingFrames.join()) throw new HttpError(409, "These aren't the frames that were matched. Take the face check again.");
  const sealed = await sealFrames(uid, frames, c.wrappedKey);
  await putObject(`public/${uid}.jpg`, await publicPhoto(frames[0]), "image/jpeg");
  const now = Date.now();
  const update = {
    status: "live",
    listed: true,
    publicPhoto: true,
    wrappedKey: sealed.wrappedKey,
    frames: { count: frames.length, sealedAt: now, sha256: sealed.sha256 },
    pendingFrames: null,
    adultSelfDeclared: { at: now },
    consent: { at: now, text: CONSENT_TEXT },
    terms: c.terms ?? defaultTerms(c.channel.subscriberCount),
    updatedAt: now,
  };
  await creators().doc(uid).update(update);
  return { ...c, ...update } as unknown as CreatorDoc;
}

export async function setTerms(uid: string, t: Terms): Promise<Terms> {
  const keys = CATEGORIES.map((x) => x.key) as string[];
  if (!t.uses?.length || t.uses.some((u) => !keys.includes(u))) throw new HttpError(400, "choose at least one allowed use");
  for (const [k, max] of [["pricePerImage", 100_000], ["maxRendersPerLicence", 100], ["maxDays", 365]] as const)
    if (!Number.isInteger(t[k]) || t[k] < 1 || t[k] > max) throw new HttpError(400, `${k} must be a whole number from 1 to ${max}`);
  const terms: Terms = {
    uses: t.uses,
    pricePerImage: t.pricePerImage,
    maxRendersPerLicence: t.maxRendersPerLicence,
    maxDays: t.maxDays,
    approval: "manual",
  };
  await creators().doc(uid).update({ terms, updatedAt: Date.now() });
  return terms;
}

export async function setListed(uid: string, listed: boolean) {
  await creators().doc(uid).update({ listed, updatedAt: Date.now() });
}

/** What anyone may see about a creator (never the wrapped key or frame hashes). */
export function publicCreator(c: CreatorDoc) {
  return {
    uid: c.uid,
    displayName: c.displayName,
    status: c.status,
    listed: c.listed,
    demo: !!c.demo,
    channel: c.channel ? { title: c.channel.title, subscriberCount: c.channel.subscriberCount, connectedAt: c.channel.connectedAt, channelId: c.channel.channelId } : null,
    faceMatch: c.faceMatch ? { score: Math.round(c.faceMatch.score * 100) / 100, at: c.faceMatch.at } : null,
    adultSelfDeclared: !!c.adultSelfDeclared,
    terms: c.terms ?? null,
    photo: c.publicPhoto ? `/api/media/creator/${c.uid}` : null,
  };
}

export async function listedCreators() {
  const s = await creators().where("listed", "==", true).limit(100).get();
  return s.docs.map((d) => d.data() as CreatorDoc).filter((c) => c.status === "live");
}
