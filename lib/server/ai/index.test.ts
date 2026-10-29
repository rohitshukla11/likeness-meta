/** AI_PROVIDER: google by default, meta on request, anything else refused. */
import { afterEach, describe, expect, it } from "vitest";
import { ai, aiProvider } from "./index";

const saved = process.env.AI_PROVIDER;
afterEach(() => {
  if (saved === undefined) delete process.env.AI_PROVIDER;
  else process.env.AI_PROVIDER = saved;
});

describe("AI provider switch", () => {
  it("defaults to google and accepts meta", () => {
    expect(aiProvider(undefined)).toBe("google");
    expect(aiProvider("")).toBe("google");
    expect(aiProvider(" Meta ")).toBe("meta");
  });
  it("refuses an unknown provider", () => {
    expect(() => aiProvider("openai")).toThrow(/must be "google" or "meta"/);
  });
  it("gives the Gemini adapters, the local face counter and a skipped reviewer with google", async () => {
    delete process.env.AI_PROVIDER;
    const s = ai();
    expect(s.provider).toBe("google");
    expect(s.imageGenerator.provider).toBe("google");
    expect(s.brandAgent.label).toBe("Gemini");
    expect(s.brandAgent.requiresPolicyCheck).toBe(false);
    const r = await s.reviewer.review({ bytes: new Uint8Array(), mime: "image/jpeg" }, "brief", {} as never);
    expect(r).toMatchObject({ pass: true, skipped: true });
  });
  it("says plainly that the meta adapters aren't built yet", () => {
    process.env.AI_PROVIDER = "meta";
    expect(() => ai()).toThrow(/Meta adapters are not built yet/);
  });
});
