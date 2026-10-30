import { FieldValue } from "firebase-admin/firestore";
import { licenceStatus } from "@/lib/model";
import { ai, aiProvider, assertAspect } from "@/lib/server/ai";
import { cleanInput, writePrompt, writePromptWithAgent } from "@/lib/server/assistant";
import { firestore } from "@/lib/server/firebase-admin";
import { docId, HttpError } from "@/lib/server/http";
import { getLicence } from "@/lib/server/licences";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { day } from "@/lib/server/render-image";
import { authed, body } from "@/lib/server/route";

const assistsPerDay = () => Number(process.env.ASSISTS_PER_DAY ?? 300);

/** "Write it for me": a detailed prompt for one of my active licences. Free to the brand; text only. */
export const POST = authed(async (req, me) => {
  await enforceRateLimit("plan", me.uid);
  const b = await body<Record<string, unknown>>(req);
  const licence = await getLicence(docId(String(b.licenceId ?? ""), "licenceId"));
  if (!licence || licence.brandId !== me.uid) throw new HttpError(404, "no such licence");
  if (licenceStatus(licence) !== "Active") throw new HttpError(409, `the licence is ${licenceStatus(licence).toLowerCase()}`);
  const usage = firestore().collection("usage").doc(day());
  if (Number((await usage.get()).data()?.assists ?? 0) >= assistsPerDay()) throw new HttpError(429, `the site's daily assistant limit (${assistsPerDay()}) is reached; try again after 00:00 UTC`);
  const input = cleanInput(b);
  // Before the model call: a shape the provider can't make never spends anything.
  assertAspect(input.aspect);
  const draft = aiProvider() === "meta" ? await writePromptWithAgent(ai().brandAgent, input, licence) : await writePrompt({ input, use: licence.use, creatorName: licence.creatorName, regenerate: b.regenerate === true });
  await usage.set({ assists: FieldValue.increment(1) }, { merge: true });
  return { draft };
});
