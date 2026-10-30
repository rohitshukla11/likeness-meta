import { warmUpOnce } from "@/lib/server/startup";

/**
 * Cloud Run's startup probe (scripts/deploy-gcp.sh): answers once the warm-up (face models, Firestore)
 * has finished, so an instance takes traffic only when it's ready. A warm-up failure is logged and still
 * answers ok: renders then fail closed on their own, rather than no instance ever starting.
 */
export async function GET() {
  const w = await warmUpOnce();
  return Response.json({ ok: true, warm: w.faceModelsMs !== null && w.firestoreMs !== null }, { headers: { "cache-control": "no-store" } });
}
