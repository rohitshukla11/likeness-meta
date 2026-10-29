/** Who auto-approves licence requests, and the daily caps for public brands. */
import { describe, expect, it } from "vitest";
import { AUTO_APPROVED_LABEL, autoApproves, capRefusal, type DailyCaps } from "./model";

describe("auto-approval", () => {
  it("is only for synthetic demo creators", () => {
    expect(autoApproves({ demo: true })).toBe(true);
    expect(autoApproves({ demo: false })).toBe(false);
    expect(autoApproves({})).toBe(false);
    expect(autoApproves(null)).toBe(false);
  });
  it("is labelled as such", () => {
    expect(AUTO_APPROVED_LABEL).toBe("auto-approved (synthetic demo creator)");
  });
});

describe("daily caps", () => {
  const caps: DailyCaps = { siteRenders: 40, brandRenders: 3 };
  const none = { renders: 0 };
  it("allow a brand's first ads", () => {
    expect(capRefusal(none, none, caps)).toBeNull();
    expect(capRefusal(none, { renders: 2 }, caps)).toBeNull();
  });
  it("stop a brand at 3 ads a day", () => {
    expect(capRefusal(none, { renders: 3 }, caps)).toMatch(/today's 3 ads, the daily limit per brand/);
  });
  it("stop everyone at the site-wide limit, with a friendly reason", () => {
    expect(capRefusal({ renders: 40 }, none, caps)).toMatch(/today's 40 ads across all brands/);
    expect(capRefusal({ renders: 12 }, none, caps)).toBeNull();
  });
});
