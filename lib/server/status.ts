import "server-only";
/** Which Google services this server can actually reach, checked live (cached for a minute). */
import { KeyManagementServiceClient } from "@google-cloud/kms";
import { Storage } from "@google-cloud/storage";
import { geminiModels } from "./gemini";
import { gcp } from "./gcp";
import { firestore } from "./firebase-admin";
import { modelsFetchable, modelsPresent } from "./facemodels";
import { secretText } from "./secret";
import { aiProvider } from "./ai";
import { metaConfigured } from "./ai/meta/client";
import { museImageConfig } from "./ai/meta/image";
import { samModel } from "./ai/meta/sam";
import { sparkConfig } from "./ai/meta/spark";

/** The Meta Model API's status from configuration only: no model call is made (each one is billed). */
export function metaApiStatus(): string {
  if (aiProvider() !== "meta") return `not used (AI_PROVIDER=${aiProvider()})`;
  if (!metaConfigured()) throw new Error("MODEL_API_KEY is not set (Secret Manager: likeness-meta-model-api-key)");
  return `key configured (not called by this check): ${museImageConfig().model}, ${sparkConfig().model}, ${samModel()}`;
}

export type Check = { key: string; name: string; ok: boolean; detail: string };

async function check(key: string, name: string, f: () => Promise<string>): Promise<Check> {
  try {
    return { key, name, ok: true, detail: await Promise.race([f(), new Promise<string>((_, j) => setTimeout(() => j(new Error("timed out")), 8000))]) };
  } catch (e) {
    return { key, name, ok: false, detail: (e as Error).message.split("\n")[0].slice(0, 200) };
  }
}

let cache: { at: number; checks: Check[] } | null = null;

export async function statusChecks(): Promise<Check[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.checks;
  const project = gcp.project();
  const checks = await Promise.all([
    check("project", "Google Cloud project", async () => {
      if (!project) throw new Error("GOOGLE_CLOUD_PROJECT is not set");
      return `${project}, region ${gcp.region()}`;
    }),
    check("firebase-auth", "Firebase Auth (Google sign-in)", async () => {
      if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY || !process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN) throw new Error("Firebase web config is not set");
      return `${process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN}`;
    }),
    check("firestore", "Firestore", async () => {
      await firestore().collection("users").limit(1).get();
      return `database "${gcp.firestoreDb()}" reachable`;
    }),
    // Only operations the least-privilege service account is granted: no key or bucket metadata reads.
    check("kms", "Cloud KMS (photo key + receipt signing key)", async () => {
      const k = new KeyManagementServiceClient();
      const [enc] = await k.encrypt({ name: gcp.photoKey(), plaintext: Buffer.from([1]), additionalAuthenticatedData: Buffer.from("status") });
      const [dec] = await k.decrypt({ name: gcp.photoKey(), ciphertext: enc.ciphertext, additionalAuthenticatedData: Buffer.from("status") });
      if (Buffer.from(dec.plaintext as Uint8Array)[0] !== 1) throw new Error("photo key round trip failed");
      const [pub] = await k.getPublicKey({ name: gcp.receiptKeyVersion() });
      return `photos: encrypt/decrypt ok; receipts: ${pub.algorithm}`;
    }),
    check("storage", "Cloud Storage (private bucket)", async () => {
      await new Storage().bucket(gcp.bucket()).file("status/probe").exists();
      return `${gcp.bucket()} reachable`;
    }),
    check("vertex-gemini", "Vertex AI Gemini (images, creative assistant, safety filter)", async () => {
      if (!project) throw new Error("no project");
      return `${geminiModels.image()} and ${geminiModels.filter()} on the global endpoint`;
    }),
    check("youtube", "YouTube Data API v3 (channel verification)", async () => "channels.list with the creator's own youtube.readonly token"),
    check("face-models", "Face matcher (YuNet + AuraFace, on this server)", async () => {
      if (modelsPresent()) return "models present";
      if (modelsFetchable()) return "models fetched on first use";
      throw new Error("models missing: run scripts/face-models.sh");
    }),
    check("meta-api", "Meta Model API (Muse Image, Muse Spark, SAM 3.1)", async () => metaApiStatus()),
    check("c2pa", "C2PA content credentials", async () => {
      if (!secretText("C2PA_CERT_PEM", "C2PA_CERT_FILE", ".secrets/c2pa/signer.pem")) throw new Error("no signing certificate");
      return "signing certificate configured (TEST certificate, not on the C2PA trust list)";
    }),
  ]);
  cache = { at: Date.now(), checks };
  return checks;
}
