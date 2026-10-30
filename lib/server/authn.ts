import "server-only";
/** Who is calling: a Firebase ID token in "Authorization: Bearer …", verified with Firebase Admin. */
import { adminAuth } from "./firebase-admin";
import { HttpError } from "./http";

export type Caller = { uid: string; email: string | null; emailVerified: boolean; name: string | null; picture: string | null };

export async function requireUser(req: Request): Promise<Caller> {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) throw new HttpError(401, "sign in first");
  try {
    const t = await adminAuth().verifyIdToken(token);
    return { uid: t.uid, email: t.email ?? null, emailVerified: t.email_verified === true, name: (t.name as string | undefined) ?? null, picture: (t.picture as string | undefined) ?? null };
  } catch {
    throw new HttpError(401, "your sign-in has expired; sign in again");
  }
}
