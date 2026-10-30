import "server-only";
/** Firebase Admin: verifies sign-in tokens, and Firestore on the named database (FIRESTORE_DATABASE). */
import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { gcp, requireProject } from "./gcp";
import { singleton } from "./util";

let app: App | null = null;
function adminApp(): App {
  if (app) return app;
  app = getApps()[0] ?? initializeApp({ projectId: requireProject() });
  return app;
}

/**
 * One Firestore client per process: Next can load this module more than once (server components and
 * route handlers are bundled separately), and settings() may only be called once per client.
 */
export function firestore(): Firestore {
  return singleton("firestore", () => {
    const db = getFirestore(adminApp(), gcp.firestoreDb());
    db.settings({ ignoreUndefinedProperties: true });
    return db;
  });
}

export const adminAuth = () => getAuth(adminApp());
