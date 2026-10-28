"use client";
/**
 * Firebase in the browser: Google sign-in, and the YouTube connect step, which asks Google for the
 * read-only YouTube scope only when the creator chooses to connect. The access token goes to our
 * server once (POST /api/creator/youtube) and is not kept.
 */
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, reauthenticateWithPopup, signInWithPopup, signOut as fbSignOut, type Auth } from "firebase/auth";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseConfigured = () => !!config.apiKey && !!config.authDomain;

let app: FirebaseApp | null = null;
export function auth(): Auth {
  app ??= getApps()[0] ?? initializeApp(config);
  return getAuth(app);
}

export async function signIn() {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: "select_account" });
  await signInWithPopup(auth(), p);
}

export const signOut = () => fbSignOut(auth());

export const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

/** Ask Google for read-only YouTube access for the signed-in account; returns the access token. */
export async function youtubeAccessToken(): Promise<string> {
  const user = auth().currentUser;
  if (!user) throw new Error("sign in first");
  const p = new GoogleAuthProvider();
  p.addScope(YOUTUBE_SCOPE);
  p.setCustomParameters({ login_hint: user.email ?? "" });
  const r = await reauthenticateWithPopup(user, p);
  const token = GoogleAuthProvider.credentialFromResult(r)?.accessToken;
  if (!token) throw new Error("Google didn't return YouTube access. Try again and allow \"See your YouTube account\".");
  return token;
}

/** fetch() to our API with the user's Firebase ID token; throws with the server's message. */
export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const user = auth().currentUser;
  const headers = new Headers(init.headers);
  if (user) headers.set("authorization", `Bearer ${await user.getIdToken()}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const r = await fetch(url, { ...init, headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `request failed (${r.status})`);
  return j as T;
}

export const reason = (e: unknown) => (e instanceof Error ? e.message.replace(/^Firebase: /, "") : String(e));
