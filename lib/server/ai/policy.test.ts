/** The model proposes, the code decides: licence status, the render cap and the keyword rules. */
import { describe, expect, it } from "vitest";
import type { LicenceDoc } from "@/lib/model";
import { ruleCheck } from "../rules";
import { decideShots, explain, licenceRefusal, reviewVerdict } from "./policy";
import type { ShotProposal } from "./types";

const now = Date.UTC(2026, 10, 1);
const licence = (o: Partial<LicenceDoc> = {}): LicenceDoc => ({
  id: "L1", requestId: "R1", brandId: "b", brandName: "Brew & Co.", creatorId: "c", creatorName: "Demo", use: "advertising",
  start: now - 86_400_000, end: now + 7 * 86_400_000, maxRenders: 4, renderCount: 0, pricePerImage: 50, createdAt: now - 86_400_000, ...o,
});
const shot = (id: string, prompt: string): ShotProposal => ({ id, prompt, aspect: "1:1", rationale: "test" });

describe("shot decisions", () => {
  it("allows clean shots under an active licence, with a plain explanation", () => {
    const d = decideShots([shot("s1", "Holding a ceramic coffee cup in a sunlit café")], licence(), ruleCheck, now);
    expect(d).toEqual([expect.objectContaining({ shotId: "s1", allowed: true, code: null })]);
    expect(d[0].explanation).toMatch(/Allowed under the Advertising licence/);
  });

  it("refuses every shot under a revoked licence", () => {
    const d = decideShots([shot("s1", "café shot"), shot("s2", "studio shot")], licence({ revokedAt: now - 1 }), ruleCheck, now);
    expect(d.every((x) => !x.allowed && x.code === "LICENCE_REVOKED")).toBe(true);
    expect(d[0].explanation).toMatch(/creator revoked this licence/);
  });

  it("refuses an expired licence and says when it ended", () => {
    const r = licenceRefusal(licence({ end: now - 1 }), now)!;
    expect(r.code).toBe("LICENCE_EXPIRED");
    expect(r.explanation).toMatch(/expired\. It ended on 2026-10-31/);
  });

  it("refuses shots beyond the renders left (over cap)", () => {
    const d = decideShots([shot("s1", "café shot"), shot("s2", "studio shot"), shot("s3", "park shot")], licence({ maxRenders: 4, renderCount: 2 }), ruleCheck, now);
    expect(d.map((x) => x.allowed)).toEqual([true, true, false]);
    expect(d[2].code).toBe("OVER_CAP");
    expect(d[2].explanation).toMatch(/2 renders left, so shot 3 was not planned/);
  });

  it("refuses a banned use by the keyword rules, naming what matched", () => {
    const d = decideShots([shot("s1", "The person at a campaign rally telling people to vote for our candidate")], licence(), ruleCheck, now);
    expect(d[0]).toMatchObject({ allowed: false, code: "BANNED_USE" });
    expect(d[0].explanation).toMatch(/Political/);
  });

  it("refuses an empty shot", () => {
    expect(decideShots([shot("s1", "  ")], licence(), ruleCheck, now)[0].code).toBe("EMPTY_BRIEF");
  });

  it("explains every refusal code in plain language", () => {
    for (const c of ["EMPTY_BRIEF", "BANNED_USE", "OUTSIDE_LICENSED_USE", "LICENCE_REVOKED", "LICENCE_EXPIRED", "OVER_CAP", "DAILY_LIMIT", "MODEL_REFUSED", "POLICY_CHECK_FAILED"] as const)
      expect(explain(c).length).toBeGreaterThan(20);
  });
});

describe("review verdict", () => {
  it("blocks on a licence violation, flags a brief mismatch, passes otherwise", () => {
    expect(reviewVerdict([{ kind: "brief", text: "a mug, not the bottle" }, { kind: "licence", text: "political poster" }])).toBe("block");
    expect(reviewVerdict([{ kind: "brief", text: "a mug, not the bottle" }])).toBe("flag");
    expect(reviewVerdict([])).toBe("pass");
  });
});
