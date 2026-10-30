import "server-only";
/**
 * Was this file licensed? Hash the exact bytes, look up the KMS-signed receipt, check its signature,
 * read the licence's current state, and read the file's C2PA manifest.
 *   Licensed  – a valid receipt, and the licence is still active
 *   Expired   – a valid receipt; the licence has since ended or used up its renders
 *   Revoked   – a valid receipt; the creator has since revoked the licence ("licensed when made")
 *   Unknown   – no valid receipt for these exact bytes (edited, re-encoded, or never licensed)
 */
import { createHash } from "node:crypto";
import { licenceStatus, useLabel, type LicenceDoc, type ReceiptPayload } from "@/lib/model";
import { readManifest, type ManifestRead } from "./c2pa";
import { getCreator, publicCreator } from "./creators";
import { firestore } from "./firebase-admin";
import { checkReceipt } from "./receipts";

export type Verdict = "Licensed" | "Expired" | "Revoked" | "Unknown";

export type VerifyResult = {
  verdict: Verdict;
  headline: string;
  sha256: string;
  receipt: { valid: boolean; keyVersion: string; payload: ReceiptPayload } | null;
  licence: { id: string; use: string; status: string; start: number; end: number; renders: string; revokedAt?: number; licensee: string } | null;
  creator: ReturnType<typeof publicCreator> | null;
  manifest: { present: boolean; signatureValid?: boolean; trustedSigner?: boolean; issuer?: string; matchesReceipt?: boolean; licenceId?: string };
  notes: string[];
};

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

export async function verifyFile(bytes: Uint8Array, mime: string): Promise<VerifyResult> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const m: ManifestRead = await readManifest(bytes, mime).catch(() => ({ present: false }) as ManifestRead);
  return verifyCore(sha256, m, []);
}

/** Check a render by its receipt key (sha256 of the file) without the file: no C2PA check. */
export async function verifyHash(sha256: string): Promise<VerifyResult> {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw Object.assign(new Error("bad sha256"), { status: 400 });
  return verifyCore(sha256, null, ["Checked by its receipt (the file's sha256) without the file itself, so its content credential wasn't read. Upload the file to check that too."]);
}

async function verifyCore(sha256: string, m: ManifestRead | null, notes: string[]): Promise<VerifyResult> {
  if (!m) m = { present: false };
  const manifest: VerifyResult["manifest"] = m.present
    ? { present: true, signatureValid: m.signatureValid, trustedSigner: m.trustedSigner, issuer: m.signer.issuer ?? m.signer.commonName, licenceId: m.licence?.licenceId }
    : { present: false };
  if (m.present && !m.trustedSigner) notes.push("The content credential is signed with this prototype's TEST certificate, which isn't on the C2PA trust list.");
  if (m.present && !m.signatureValid) notes.push("The content credential's signature does not validate: the file was changed after signing.");
  notes.push("Images from Google's Gemini models also carry SynthID, Google's invisible AI watermark. This page doesn't detect SynthID; Google's SynthID Detector does.");

  const rs = await firestore().collection("receipts").doc(sha256).get();
  if (!rs.exists) {
    const claim = m.present && m.licence ? ` Its content credential names licence ${m.licence.licenceId}, but the receipt is for the exact original bytes, so this copy was edited or re-encoded.` : "";
    return { verdict: "Unknown", headline: `Unknown. No signed receipt for these exact bytes.${claim}`, sha256, receipt: null, licence: null, creator: null, manifest, notes };
  }
  const r = rs.data() as { payload: ReceiptPayload; signature: string; keyVersion: string };
  const valid = await checkReceipt(r);
  if (!valid) {
    notes.push("A receipt exists but its signature does not verify with the Cloud KMS public key.");
    return { verdict: "Unknown", headline: "Unknown. The receipt's signature does not verify.", sha256, receipt: { valid, keyVersion: r.keyVersion, payload: r.payload }, licence: null, creator: null, manifest, notes };
  }
  manifest.matchesReceipt = m.present ? m.licence?.licenceId === r.payload.licenceId : undefined;
  const ls = await firestore().collection("licences").doc(r.payload.licenceId).get();
  const l = ls.data() as LicenceDoc;
  const status = licenceStatus(l);
  const c = await getCreator(l.creatorId);
  const made = day(r.payload.createdAt);
  const verdict: Verdict = status === "Active" ? "Licensed" : status === "Revoked" ? "Revoked" : "Expired";
  const headline =
    verdict === "Licensed"
      ? `Licensed. Made on ${made} under an active licence for ${useLabel(l.use).toLowerCase()} use.`
      : verdict === "Revoked"
        ? `Revoked. Licensed when made (${made}), since revoked on ${day(l.revokedAt!)}.`
        : `Expired. Licensed when made (${made}); the licence has ${status === "Exhausted" ? "used all its renders" : `ended (${day(l.end)})`}.`;
  if (c?.demo) notes.push("The creator is a synthetic demo creator: a generated face, not a real person.");
  if (c) notes.push("Creator verification: YouTube account ownership and a live face matched to the channel avatar. Age is self-declared; legal identity isn't checked.");
  return {
    verdict,
    headline,
    sha256,
    receipt: { valid, keyVersion: r.keyVersion, payload: r.payload },
    licence: { id: l.id, use: useLabel(l.use), status, start: l.start, end: l.end, renders: `${l.renderCount} of ${l.maxRenders}`, revokedAt: l.revokedAt, licensee: l.brandName },
    creator: c ? publicCreator(c) : null,
    manifest,
    notes,
  };
}
