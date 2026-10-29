/**
 * The alternative-shot step: when the policy code refuses a proposed shot, or the reviewer flags one,
 * the brand agent gets at most one retry to propose a compliant alternative, with the reason as input.
 * The policy code checks the alternative again; a second refusal is final. Only reasons another prompt
 * could fix are retried: a banned use, a use outside the licence, an empty shot, a reviewer's flag.
 * Never retried: a revoked or expired licence, the render cap (OVER_CAP), the daily limit, a failed
 * policy check, a model refusal. Provider-neutral and free of I/O: the agent is passed in.
 */
import type { LicenceDoc } from "@/lib/model";
import { decideShots, explain } from "./policy";
import type { AlternativeReason, BrandAgent, BrandBrief, CallMetrics, ShotDecision, ShotPlan, ShotProposal } from "./types";

export const RETRYABLE: ReadonlySet<string> = new Set(["BANNED_USE", "OUTSIDE_LICENSED_USE", "EMPTY_BRIEF", "REVIEW_FLAG"]);
export const retryable = (code: string | null | undefined) => !!code && RETRYABLE.has(code);

/** One attempt at a shot, for the step log: attempt 1 is the first proposal, attempt 2 the alternative. */
export type ShotAttempt = { attempt: 1 | 2; shotId: string; allowed: boolean; code: string | null; explanation: string };

export type AlternativeResult = { shot: ShotProposal | null; decision: ShotDecision; attempt: ShotAttempt; metrics: CallMetrics | null };

/**
 * Ask for one alternative and decide it. `allowedSoFar` is how many shots of this plan are already
 * allowed (they count against the renders left).
 */
export async function proposeAlternative(agent: BrandAgent, shot: ShotProposal, reason: AlternativeReason, licence: LicenceDoc, ruleHits: (t: string) => string[], allowedSoFar = 0): Promise<AlternativeResult | null> {
  if (!retryable(reason.code) || !agent.reviseShot) return null;
  const id = `${shot.id}-alt`;
  const r = await agent.reviseShot(shot, reason, licence);
  if (!r.shot) {
    const decision: ShotDecision = { shotId: id, alternativeOf: shot.id, allowed: false, code: "MODEL_REFUSED", explanation: explain("MODEL_REFUSED", `No alternative was proposed: ${r.note}`) };
    return { shot: null, decision, attempt: { attempt: 2, shotId: id, allowed: false, code: decision.code, explanation: decision.explanation }, metrics: r.metrics };
  }
  const alt: ShotProposal = { ...r.shot, id };
  const [d] = decideShots([alt], { ...licence, renderCount: licence.renderCount + allowedSoFar }, ruleHits);
  const decision: ShotDecision = { ...d, alternativeOf: shot.id };
  return { shot: alt, decision, attempt: { attempt: 2, shotId: id, allowed: d.allowed, code: d.code, explanation: d.explanation }, metrics: r.metrics };
}

/** planShots, then one alternative for each shot the policy refused for a retryable reason. */
export async function planWithAlternatives(agent: BrandAgent, brief: BrandBrief, licence: LicenceDoc, ruleHits: (t: string) => string[]): Promise<ShotPlan & { attempts: ShotAttempt[]; extraMetrics: CallMetrics[] }> {
  const plan = await agent.planShots(brief, licence);
  const attempts: ShotAttempt[] = plan.decisions.filter((d) => d.shotId).map((d) => ({ attempt: 1, shotId: d.shotId!, allowed: d.allowed, code: d.code, explanation: d.explanation }));
  const shots = [...plan.shots];
  const decisions = [...plan.decisions];
  const extraMetrics: CallMetrics[] = [];
  let allowedSoFar = plan.decisions.filter((d) => d.allowed).length;
  for (const d of plan.decisions) {
    const shot = d.shotId ? plan.shots.find((s) => s.id === d.shotId) : undefined;
    if (d.allowed || !shot || !d.code) continue;
    const alt = await proposeAlternative(agent, shot, { code: d.code, explanation: d.explanation }, licence, ruleHits, allowedSoFar);
    if (!alt) continue;
    attempts.push(alt.attempt);
    decisions.push(alt.decision);
    if (alt.metrics) extraMetrics.push(alt.metrics);
    if (alt.shot) shots.push(alt.shot);
    if (alt.decision.allowed) allowedSoFar++;
  }
  return { ...plan, shots, decisions, attempts, extraMetrics };
}
