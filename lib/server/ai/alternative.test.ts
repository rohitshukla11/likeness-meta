/** The alternative-shot step, with a mocked brand agent: one retry at most, the policy code decides both times. */
import { describe, expect, it, vi } from "vitest";
import type { LicenceDoc } from "@/lib/model";
import { ruleCheck } from "../rules";
import { planWithAlternatives, proposeAlternative } from "./alternative";
import { decideShots } from "./policy";
import type { AlternativeReason, BrandAgent, ShotProposal } from "./types";

const now = Date.now();
const licence = (o: Partial<LicenceDoc> = {}): LicenceDoc => ({
  id: "L1", requestId: "R1", brandId: "b", brandName: "Brew & Co.", creatorId: "c", creatorName: "Demo", use: "advertising",
  start: now - 86_400_000, end: now + 7 * 86_400_000, maxRenders: 4, renderCount: 0, pricePerImage: 200, createdAt: now - 86_400_000, ...o,
});
const shot = (id: string, prompt: string): ShotProposal => ({ id, prompt, aspect: "1:1", rationale: "r" });
const brief = { idea: "promo", product: "cup", setting: "café", mood: "warm" as const, aspect: "1:1" as const };
const metrics = { provider: "meta" as const, model: "muse-spark-1.3", latencyMs: 1, cost: null };
const banned = shot("shot-1", "The person at a campaign rally telling people to vote for our candidate");
const clean = shot("shot-1", "Medium close-up of the person holding a ceramic cup in a sunlit café");

/** An agent whose plan is the given shots, decided by the real policy code; reviseShot answers in turn. */
function agent(planned: ShotProposal[], revisions: (ShotProposal | null)[], l = licence()) {
  const reviseShot = vi.fn(async (_shot: ShotProposal, _reason: AlternativeReason, _licence: LicenceDoc) => {
    void _shot, void _reason, void _licence;
    const next = revisions.shift() ?? null;
    return { shot: next, note: next ? "fixed" : "no compliant alternative", metrics };
  });
  const a: BrandAgent = {
    label: "Mock",
    configHint: "KEY",
    policyConfigured: () => true,
    checkPolicy: vi.fn(),
    planShots: vi.fn(async () => ({ shots: planned, decisions: decideShots(planned, l, ruleCheck), metrics })),
    reviseShot,
  };
  return { a, reviseShot };
}

describe("alternative shot", () => {
  it("refused, then approved: the alternative passes the policy code", async () => {
    const { a, reviseShot } = agent([banned], [clean]);
    const p = await planWithAlternatives(a, brief, licence(), ruleCheck);
    expect(reviseShot).toHaveBeenCalledTimes(1);
    expect(reviseShot.mock.calls[0][1]).toMatchObject({ code: "BANNED_USE", explanation: expect.stringMatching(/Political/) });
    expect(p.attempts).toEqual([
      expect.objectContaining({ attempt: 1, shotId: "shot-1", allowed: false, code: "BANNED_USE" }),
      expect.objectContaining({ attempt: 2, shotId: "shot-1-alt", allowed: true, code: null }),
    ]);
    expect(p.decisions.find((d) => d.allowed)).toMatchObject({ shotId: "shot-1-alt", alternativeOf: "shot-1" });
    expect(p.shots.map((s) => s.id)).toEqual(["shot-1", "shot-1-alt"]);
  });

  it("refused twice: the second refusal is final, and there is no third try", async () => {
    const { a, reviseShot } = agent([banned], [shot("x", "Now the person posing as a famous senator at a press event"), clean]);
    const p = await planWithAlternatives(a, brief, licence(), ruleCheck);
    expect(reviseShot).toHaveBeenCalledTimes(1);
    expect(p.attempts.map((x) => [x.attempt, x.allowed, x.code])).toEqual([[1, false, "BANNED_USE"], [2, false, "BANNED_USE"]]);
    expect(p.decisions.some((d) => d.allowed)).toBe(false);
  });

  it("a model that declines to propose one is a final MODEL_REFUSED", async () => {
    const { a } = agent([banned], [null]);
    const p = await planWithAlternatives(a, brief, licence(), ruleCheck);
    expect(p.attempts[1]).toMatchObject({ attempt: 2, allowed: false, code: "MODEL_REFUSED" });
  });

  it("never retries a revoked licence", async () => {
    const l = licence({ revokedAt: now - 1 });
    const { a, reviseShot } = agent([clean], [clean], l);
    const p = await planWithAlternatives(a, brief, l, ruleCheck);
    expect(p.decisions.every((d) => d.code === "LICENCE_REVOKED")).toBe(true);
    expect(reviseShot).not.toHaveBeenCalled();
  });

  it("never retries a shot refused for the render cap (OVER_CAP)", async () => {
    const l = licence({ maxRenders: 4, renderCount: 3 });
    const { a, reviseShot } = agent([clean, shot("shot-2", "Another café shot with the cup")], [clean], l);
    const p = await planWithAlternatives(a, brief, l, ruleCheck);
    expect(p.decisions.map((d) => d.code)).toEqual([null, "OVER_CAP"]);
    expect(reviseShot).not.toHaveBeenCalled();
  });

  it("a reviewer's flag gets one alternative; a failed policy check doesn't", async () => {
    const { a, reviseShot } = agent([], [clean]);
    const r = await proposeAlternative(a, clean, { code: "REVIEW_FLAG", explanation: "The product isn't the one in the shot." }, licence(), ruleCheck);
    expect(r).toMatchObject({ decision: { allowed: true, alternativeOf: "shot-1" }, attempt: { attempt: 2 } });
    expect(await proposeAlternative(a, clean, { code: "POLICY_CHECK_FAILED", explanation: "x" }, licence(), ruleCheck)).toBeNull();
    expect(reviseShot).toHaveBeenCalledTimes(1);
  });

  it("an agent without reviseShot gets no retry", async () => {
    const { a } = agent([banned], [clean]);
    delete a.reviseShot;
    const p = await planWithAlternatives(a, brief, licence(), ruleCheck);
    expect(p.attempts).toHaveLength(1);
  });
});
