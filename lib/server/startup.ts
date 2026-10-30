import "server-only";
/**
 * Server start (instrumentation.ts): refuse to run with AI_PROVIDER=fixture in production, then warm up
 * what the first render would otherwise wait for: the face models (YuNet, AuraFace) and the Firestore
 * connection (with the judge registry the render's limits read). A warm-up failure is logged, not fatal:
 * renders still fail closed at the consent gate.
 */
import { aiProvider } from "./ai";
import { judgeRegistryCached } from "./demo";
import { warmFaceModels } from "./facematch";
import { singleton } from "./util";

/** Stop the server if the configured provider isn't allowed here (AI_PROVIDER=fixture in production). */
export function refuseDisallowedProvider(): void {
  try {
    aiProvider();
  } catch (e) {
    console.error(JSON.stringify({ service: "startup", error: (e as Error).message }));
    process.exit(1);
  }
}

export type WarmUpResult = { faceModelsMs: number | null; firestoreMs: number | null };

const warming = singleton("warm-up", () => ({ p: null as Promise<WarmUpResult> | null }));
/**
 * The warm-up, once per process: instrumentation.ts starts it, and /api/health (Cloud Run's startup
 * probe) waits for it, so an instance takes traffic only once the face models and Firestore are ready.
 */
export function warmUpOnce(): Promise<WarmUpResult> {
  return (warming.p ??= warmUp());
}

export async function warmUp(): Promise<WarmUpResult> {
  const time = async (f: () => Promise<unknown>) => {
    const t = Date.now();
    try {
      await f();
      return Date.now() - t;
    } catch (e) {
      console.error(JSON.stringify({ service: "warm-up", error: String((e as Error).message).slice(0, 200) }));
      return null;
    }
  };
  const [faceModelsMs, firestoreMs] = await Promise.all([time(warmFaceModels), time(judgeRegistryCached)]);
  console.log(JSON.stringify({ service: "warm-up", faceModelsMs, firestoreMs }));
  return { faceModelsMs, firestoreMs };
}
