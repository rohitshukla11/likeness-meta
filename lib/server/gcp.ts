import "server-only";
/**
 * Google Cloud configuration for the whole server. One project; Vertex AI Gemini on the global
 * endpoint; Firestore, KMS and the private bucket in REGION (us-central1). Credentials are
 * Application Default Credentials: the Cloud Run service account in production,
 * `gcloud auth application-default login` locally. No API keys.
 */
import { GoogleAuth } from "google-auth-library";

/**
 * likeness-ai (the AI Builder Cup entry) keeps its data in Firestore database "likeness" and the bucket
 * <project>-likeness-private. This server never writes there: those names are refused outright.
 */
const notLikenessAi = (kind: string, name: string, theirs: string) => {
  if (name === theirs) throw Object.assign(new Error(`${kind} "${name}" belongs to likeness-ai; use likeness-meta's own`), { status: 500 });
  return name;
};

export const gcp = {
  project: () => process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "",
  region: () => process.env.GCP_REGION || "us-central1",
  firestoreDb: () => notLikenessAi("Firestore database", process.env.FIRESTORE_DATABASE || "likeness-meta", "likeness"),
  bucket: () => {
    const b = process.env.GCS_BUCKET || (gcp.project() ? `${gcp.project()}-likeness-meta-private` : "");
    return b ? notLikenessAi("bucket", b, `${gcp.project()}-likeness-private`) : b;
  },
  kmsKeyRing: () => process.env.KMS_KEYRING || "likeness",
  photoKey: () => `projects/${gcp.project()}/locations/${gcp.region()}/keyRings/${gcp.kmsKeyRing()}/cryptoKeys/${process.env.KMS_PHOTO_KEY || "photos"}`,
  receiptKey: () => `projects/${gcp.project()}/locations/${gcp.region()}/keyRings/${gcp.kmsKeyRing()}/cryptoKeys/${process.env.KMS_RECEIPT_KEY || "receipts"}`,
  receiptKeyVersion: () => `${gcp.receiptKey()}/cryptoKeyVersions/${process.env.KMS_RECEIPT_KEY_VERSION || "1"}`,
};

let auth: GoogleAuth | null = null;
/** An OAuth access token for Google APIs called over REST (Vertex AI). */
export async function accessToken(): Promise<string> {
  auth ??= new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const t = await auth.getAccessToken();
  if (!t) throw Object.assign(new Error("no Google credentials (ADC) on this server"), { status: 503 });
  return t;
}

export function requireProject(): string {
  const p = gcp.project();
  if (!p) throw Object.assign(new Error("GOOGLE_CLOUD_PROJECT is not set"), { status: 503 });
  return p;
}
