/** Server start: refuse AI_PROVIDER=fixture in production, then warm up the face models and Firestore (lib/server/startup.ts). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { refuseDisallowedProvider, warmUpOnce } = await import("./lib/server/startup");
  refuseDisallowedProvider();
  await warmUpOnce();
}
