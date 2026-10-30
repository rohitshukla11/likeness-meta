import "server-only";
/**
 * Render receipts: canonical JSON of what was made under which licence, signed by the KMS key
 * "receipts" (EC P-256, SHA-256). Stored at receipts/{sha256 of the delivered file}. The verifier
 * re-checks the signature with the KMS public key.
 */
import { createHash } from "node:crypto";
import type { ReceiptPayload } from "@/lib/model";
import { signReceipt, verifyReceiptSignature } from "./kms";

export type SignedReceipt = { payload: ReceiptPayload; canonical: string; signature: string; keyVersion: string; alg: "EC_SIGN_P256_SHA256" };

export function canonical(p: ReceiptPayload): string {
  const keys = Object.keys(p).sort() as (keyof ReceiptPayload)[];
  return JSON.stringify(Object.fromEntries(keys.map((k) => [k, p[k]])));
}

export async function signPayload(p: ReceiptPayload): Promise<SignedReceipt> {
  const c = canonical(p);
  const { signature, keyVersion } = await signReceipt(createHash("sha256").update(c).digest());
  return { payload: p, canonical: c, signature, keyVersion, alg: "EC_SIGN_P256_SHA256" };
}

export async function checkReceipt(r: Pick<SignedReceipt, "payload" | "signature" | "keyVersion">): Promise<boolean> {
  try {
    return await verifyReceiptSignature(Buffer.from(canonical(r.payload)), r.signature, r.keyVersion);
  } catch {
    return false;
  }
}
