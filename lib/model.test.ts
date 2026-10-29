import { describe, expect, it } from "vitest";
import { audiencePrice, creatorFee, defaultTerms, licenceStatus, subscriberLabel } from "./model";

describe("pricing by audience", () => {
  it("raises the price per image with the channel's audience", () => {
    expect(audiencePrice(null)).toEqual({ image: 50 });
    expect(audiencePrice(999)).toEqual({ image: 50 });
    expect(audiencePrice(25_000)).toEqual({ image: 200 });
    expect(audiencePrice(2_000_000)).toEqual({ image: 1000 });
  });
  it("starts creators on manual approval with advertising and social", () => {
    expect(defaultTerms(150_000)).toMatchObject({ uses: ["advertising", "social"], pricePerImage: 500, approval: "manual" });
  });
});

describe("the 10% fee", () => {
  it("rounds the fee down, so the creator never gets less than 90%", () => {
    expect(creatorFee(200)).toEqual({ creator: 180, fee: 20 });
    expect(creatorFee(55)).toEqual({ creator: 50, fee: 5 });
    expect(creatorFee(9)).toEqual({ creator: 9, fee: 0 });
  });
});

describe("licence status", () => {
  const l = { end: 2_000, renderCount: 0, maxRenders: 2 };
  it("is Active, then Exhausted, Expired or Revoked", () => {
    expect(licenceStatus(l, 1_000)).toBe("Active");
    expect(licenceStatus({ ...l, renderCount: 2 }, 1_000)).toBe("Exhausted");
    expect(licenceStatus(l, 2_000)).toBe("Expired");
    expect(licenceStatus({ ...l, revokedAt: 1_500 }, 1_000)).toBe("Revoked");
  });
});

describe("subscriber labels", () => {
  it("formats counts like YouTube", () => {
    expect(subscriberLabel(null)).toBe("subscriber count hidden");
    expect(subscriberLabel(1)).toBe("1 subscriber");
    expect(subscriberLabel(12_300)).toBe("12K subscribers");
    expect(subscriberLabel(1_460_000)).toBe("1.5M subscribers");
  });
});
