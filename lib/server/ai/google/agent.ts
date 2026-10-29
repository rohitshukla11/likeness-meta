import "server-only";
/**
 * BrandAgent on Vertex AI Gemini, for AI_PROVIDER=google:
 *  - checkPolicy: likeness-ai's Gemini prompt classifier (moved here unchanged from lib/server/filter.ts);
 *  - planShots: likeness-ai's creative assistant (lib/server/assistant.ts) writes each shot; the licence
 *    policy code decides (../policy.ts).
 */
import { CATEGORIES } from "@/lib/categories";
import type { LicenceDoc } from "@/lib/model";
import { AssistantRefused, cleanInput, writePrompt } from "../../assistant";
import { generateContent, geminiModels, vertexConfigured } from "../../gemini";
import { ruleCheck } from "../../rules";
import { decideShots, explain } from "../policy";
import type { BrandAgent, BrandBrief, ModelPolicyVerdict, ShotPlan, ShotProposal } from "../types";

const FILTER_INSTRUCTION = `You screen prompts for an image generator that renders a real, consenting adult's likeness under a licence.
Banned uses, never allowed under any licence:
- political: elections, candidates, parties, policy advocacy;
- adult: sexual or sexualised content, nudity;
- minors: anything involving minors or a childlike depiction;
- impersonation: presenting the person as someone else, or as endorsing or saying something they did not;
- deception: fake news, fake evidence, fake testimonials, depicting crimes or events as real.
The licence covers exactly one use category. Decide whether the prompt fits it.
Return JSON matching the schema.`;

// JSON Schema for generationConfig.responseJsonSchema (responseSchema is deprecated).
const FILTER_SCHEMA = {
  type: "object",
  properties: {
    banned: { type: "array", items: { type: "string", enum: ["political", "adult", "minors", "impersonation", "deception"] } },
    fitsCategory: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["banned", "fitsCategory", "reason"],
};

const MAX_SHOTS = 4;

async function checkPolicy(prompt: string, licence: LicenceDoc): Promise<ModelPolicyVerdict> {
  const category = CATEGORIES.find((c) => c.key === licence.use)?.label ?? "unknown";
  const model = geminiModels.filter();
  const t = Date.now();
  const res = await generateContent(
    model,
    {
      systemInstruction: { parts: [{ text: FILTER_INSTRUCTION }] },
      contents: [{ role: "user", parts: [{ text: `Licence category: ${category}\nPrompt: ${prompt}` }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", responseJsonSchema: FILTER_SCHEMA },
    },
    20_000,
  );
  const metrics = { provider: "google" as const, model, latencyMs: Date.now() - t, usage: res.usageMetadata, costUsd: null };
  if (res.promptFeedback?.blockReason) return { banned: ["blocked by Gemini safety"], fitsCategory: false, reason: res.promptFeedback.blockReason, metrics };
  const text = res.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const out = JSON.parse(text);
  if (!Array.isArray(out.banned) || typeof out.fitsCategory !== "boolean") throw new Error("Gemini filter returned an unexpected shape");
  return { banned: out.banned.map(String), fitsCategory: out.fitsCategory, reason: String(out.reason ?? ""), metrics };
}

async function planShots(brief: BrandBrief, licence: LicenceDoc): Promise<ShotPlan> {
  const t = Date.now();
  const n = Math.min(MAX_SHOTS, Math.max(1, Math.floor(brief.shots ?? 1)));
  const input = cleanInput(brief);
  const shots: ShotProposal[] = [];
  const metrics = () => ({ provider: "google" as const, model: geminiModels.filter(), latencyMs: Date.now() - t, costUsd: null });
  try {
    for (let i = 0; i < n; i++) {
      const d = await writePrompt({ input, use: licence.use, creatorName: licence.creatorName, regenerate: i > 0 });
      shots.push({ id: `shot-${i + 1}`, prompt: d.brief, aspect: d.aspect, rationale: d.note ?? `Written by ${d.source}.` });
    }
  } catch (e) {
    if (!(e instanceof AssistantRefused)) throw e;
    const code = /banned/i.test(e.message) ? "BANNED_USE" : "MODEL_REFUSED";
    return { shots: [], decisions: [{ shotId: null, allowed: false, code, explanation: explain(code, e.message) }], metrics: metrics() };
  }
  return { shots, decisions: decideShots(shots, licence, ruleCheck), metrics: metrics() };
}

export const geminiBrandAgent: BrandAgent = {
  label: "Gemini",
  configHint: "GOOGLE_CLOUD_PROJECT",
  requiresPolicyCheck: false,
  policyConfigured: vertexConfigured,
  planShots,
  checkPolicy,
};
