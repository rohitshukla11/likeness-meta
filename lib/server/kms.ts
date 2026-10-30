import "server-only";
/**
 * Cloud KMS.
 *  - Envelope encryption: each creator's photos are encrypted with their own random 256-bit data key
 *    (DEK, AES-256-GCM, generated here); the DEK is stored only wrapped by the KMS key "photos", with
 *    the creator id as additional authenticated data, so a wrapped key can't be moved to another creator.
 *    Only the Cloud Run service account holds cryptoKeyEncrypterDecrypter on that key, and KMS Data
 *    Access audit logs record every unwrap.
 *  - Receipts: an asymmetric EC_SIGN_P256_SHA256 key "receipts" signs each render receipt; anyone with
 *    the public key can check it.
 */
import { createPublicKey, verify } from "node:crypto";
import { KeyManagementServiceClient } from "@google-cloud/kms";
import { gcp } from "./gcp";

let client: KeyManagementServiceClient | null = null;
const kms = () => (client ??= new KeyManagementServiceClient());
const aad = (creatorId: string) => Buffer.from(`likeness-ai|dek|${creatorId}`);

export async function wrapKey(dek: Uint8Array, creatorId: string): Promise<string> {
  const [r] = await kms().encrypt({ name: gcp.photoKey(), plaintext: Buffer.from(dek), additionalAuthenticatedData: aad(creatorId) });
  return Buffer.from(r.ciphertext as Uint8Array).toString("base64");
}

export async function unwrapKey(wrapped: string, creatorId: string): Promise<Uint8Array> {
  const [r] = await kms().decrypt({ name: gcp.photoKey(), ciphertext: Buffer.from(wrapped, "base64"), additionalAuthenticatedData: aad(creatorId) });
  return new Uint8Array(r.plaintext as Uint8Array);
}

/** Sign sha256(message) with the receipt key. Returns a DER-encoded ECDSA signature, base64. */
export async function signReceipt(digest: Buffer): Promise<{ signature: string; keyVersion: string }> {
  const [r] = await kms().asymmetricSign({ name: gcp.receiptKeyVersion(), digest: { sha256: digest } });
  return { signature: Buffer.from(r.signature as Uint8Array).toString("base64"), keyVersion: gcp.receiptKeyVersion() };
}

const pems = new Map<string, string>();
export async function receiptPublicKey(keyVersion = gcp.receiptKeyVersion()): Promise<string> {
  const hit = pems.get(keyVersion);
  if (hit) return hit;
  const [r] = await kms().getPublicKey({ name: keyVersion });
  pems.set(keyVersion, r.pem!);
  return r.pem!;
}

export async function verifyReceiptSignature(message: Buffer, signatureB64: string, keyVersion: string): Promise<boolean> {
  const pem = await receiptPublicKey(keyVersion);
  return verify("sha256", message, createPublicKey(pem), Buffer.from(signatureB64, "base64"));
}
