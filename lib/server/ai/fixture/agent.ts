import "server-only";
/**
 * BrandAgent for development only (AI_PROVIDER=fixture): no model. The policy "check" accepts every prompt
 * that passed the keyword rules, and a plan is the brief as one shot, decided by the policy code. It lets a
 * dry run go end to end for free; what only a model can judge (a use outside the licence, the reviewer)
 * is reported by the eval as needing a model. Refused in production like the fixture image.
 */
import { ruleCheck } from "../../rules";
import { decideShots } from "../policy";
import type { BrandAgent, CallMetrics } from "../types";

const metrics = (): CallMetrics => ({ provider: "fixture", model: "fixture:no-policy-model", latencyMs: 0, cost: { costUsd: 0, estimate: true, basis: "fixture: no model call" } });

export const fixtureBrandAgent: BrandAgent = {
  label: "Fixture",
  configHint: "none",
  policyConfigured: () => true,
  checkPolicy: async () => ({ banned: [], fitsCategory: true, reason: "fixture: no policy model (development only)", metrics: metrics() }),
  planShots: async (brief, licence) => {
    const shots = [{ id: "shot-1", prompt: brief.text ?? brief.idea, aspect: brief.aspect, rationale: "fixture: the brief as given" }];
    return { shots, decisions: decideShots(shots, licence, ruleCheck), metrics: metrics() };
  },
};
