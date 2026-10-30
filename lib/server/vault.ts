import "server-only";
/**
 * The creator's reference frames, encrypted with a per-creator data key (AES-256-GCM) that exists only
 * wrapped by Cloud KMS. Ciphertext goes to the private bucket. Opening needs the render service's
 * KMS permission, and every opening is written to Firestore (decryptions) as well as KMS's own
 * Data Access audit log.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import type { CreatorDoc } from "@/lib/model";
import { firestore } from "./firebase-admin";
import { HttpError } from "./http";
import { unwrapKey, wrapKey } from "./kms";
import { getObject, putObject } from "./storage";

const aad = (uid: string, i: number) => Buffer.from(`likeness-ai|frame|${uid}|${i}`);
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function seal(key: Uint8Array, plain: Uint8Array, ad: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(ad);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), ct]); // v1 | iv(12) | tag(16) | ct
}

function open(key: Uint8Array, box: Buffer, ad: Buffer): Buffer {
  if (box[0] !== 1) throw new Error("unknown ciphertext version");
  const d = createDecipheriv("aes-256-gcm", key, box.subarray(1, 13));
  d.setAAD(ad);
  d.setAuthTag(box.subarray(13, 29));
  return Buffer.concat([d.update(box.subarray(29)), d.final()]);
}

/** Encrypt and store the frames, creating the creator's data key on first use. Returns their sha256. */
export async function sealFrames(uid: string, frames: Uint8Array[], existingWrapped?: string): Promise<{ wrappedKey: string; sha256: string[] }> {
  let dek: Uint8Array;
  let wrappedKey = existingWrapped;
  if (wrappedKey) dek = await unwrapKey(wrappedKey, uid);
  else {
    dek = new Uint8Array(randomBytes(32));
    wrappedKey = await wrapKey(dek, uid);
  }
  try {
    for (const [i, f] of frames.entries()) await putObject(`vault/${uid}/${i}.bin`, seal(dek, f, aad(uid, i)), "application/octet-stream");
    return { wrappedKey, sha256: frames.map(sha256) };
  } finally {
    dek.fill(0);
  }
}

/** Open the frames for one purpose (a render under a licence). Logged before the key is unwrapped. */
/** Why the photos are opened, as the creator sees it in "Who opened your photos". */
export type OpeningPurpose = {
  licenceId: string;
  renderId: string;
  by: string;
  /** A purpose label for anything that isn't a real render ("Setup: …", "Test render (development)", "Evaluation run (automated test)"); real renders have none. */
  label?: string;
};

export async function openFrames(c: Pick<CreatorDoc, "uid" | "wrappedKey" | "frames">, purpose: OpeningPurpose): Promise<Uint8Array[]> {
  if (!c.wrappedKey || !c.frames?.count) throw new HttpError(409, "this creator has no protected photos");
  await firestore().collection("decryptions").add({ creatorId: c.uid, ...purpose, at: Date.now(), serverAt: FieldValue.serverTimestamp() });
  // Logged first; then the key is unwrapped while the ciphertexts download, in parallel.
  const n = c.frames.count;
  const [dek, boxes] = await Promise.all([unwrapKey(c.wrappedKey, c.uid), Promise.all(Array.from({ length: n }, (_, i) => getObject(`vault/${c.uid}/${i}.bin`)))]);
  try {
    const out: Uint8Array[] = [];
    for (let i = 0; i < n; i++) {
      const box = boxes[i];
      if (!box) throw new HttpError(500, `frame ${i} is missing from storage`);
      const plain = open(dek, box, aad(c.uid, i));
      if (sha256(plain) !== c.frames.sha256[i]) throw new HttpError(500, `frame ${i} does not match its recorded hash`);
      out.push(new Uint8Array(plain));
    }
    return out;
  } finally {
    dek.fill(0);
  }
}
