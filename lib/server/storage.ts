import "server-only";
/**
 * The private Cloud Storage bucket (uniform access, public access prevention). Objects:
 *   vault/<creator>/<n>.bin      encrypted reference frames (ciphertext only)
 *   public/<creator>.jpg         the creator's public photo (512 px, labelled)
 *   renders/<sha256>.<ext>       paid renders, delivered by short-lived V4 signed URLs
 */
import { Storage } from "@google-cloud/storage";
import { gcp } from "./gcp";

let client: Storage | null = null;
const bucket = () => (client ??= new Storage()).bucket(gcp.bucket());

export async function putObject(path: string, bytes: Uint8Array | Buffer, contentType: string): Promise<void> {
  await bucket().file(path).save(Buffer.from(bytes), { contentType, resumable: false, metadata: { cacheControl: "private, max-age=0" } });
}

/** The object's bytes, or null if it doesn't exist (one request: the download, a 404 meaning absent). */
export async function getObject(path: string): Promise<Buffer | null> {
  try {
    const [b] = await bucket().file(path).download();
    return b;
  } catch (e) {
    if ((e as { code?: unknown }).code === 404) return null;
    throw e;
  }
}

/** Delete an object; a missing one is fine (used to clean up a render refused at payment). */
export async function deleteObject(path: string): Promise<void> {
  await bucket().file(path).delete({ ignoreNotFound: true });
}

/** A V4 signed URL for reading one object (the service account signs through IAM signBlob). */
export async function signedUrl(path: string, minutes = 15): Promise<string> {
  const [url] = await bucket().file(path).getSignedUrl({ version: "v4", action: "read", expires: Date.now() + minutes * 60_000 });
  return url;
}
