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
    const r = await s.reviewer.review({ bytes: new Uint8Array(), mime: "image/jpeg" }, { id: "s", prompt: "p", aspect: "1:1", rationale: "" }, {} as never);
    expect(r).toMatchObject({ verdict: "pass", skipped: true });
  });
  it("gives Muse Image, SAM 3.1 and the Muse Spark agent and reviewer with meta", async () => {
    process.env.AI_PROVIDER = "meta";
    const s = ai();
    expect(s.provider).toBe("meta");
    expect(s.imageGenerator.provider).toBe("meta");
    expect(s.brandAgent.label).toBe("Muse Spark");
    expect(s.brandAgent.configHint).toBe("MODEL_API_KEY");
    expect(s.segmenter).toBe((await import("./meta/sam")).samSegmenter);
  });
});
