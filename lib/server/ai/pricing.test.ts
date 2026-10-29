/** Cost estimates from usage and the one pricing table. */
import { describe, expect, it } from "vitest";
import { estimateCost, renderCost, showModelCost } from "./pricing";

describe("cost estimates", () => {
  it("prices Muse Spark tokens, cached input at the cached rate", () => {
    const c = estimateCost("meta", "muse-spark-1.3", { input_tokens: 10_000, output_tokens: 2_000, input_tokens_details: { cached_tokens: 4_000 } })!;
    // 6,000 × 1.25 + 4,000 × 0.15 + 2,000 × 4.25, per million
    expect(c.costUsd).toBeCloseTo(0.0166, 6);
    expect(c.estimate).toBe(true);
  });
  it("prices Muse Image per generated image and SAM 3.1 per image segmented", () => {
    expect(estimateCost("meta", "muse-image-1.0", undefined, 1)!.costUsd).toBe(0.01);
    expect(estimateCost("meta", "sam-3.1", undefined, 4)!.costUsd).toBe(0.01);
  });
  it("is null for a model without a pinned price (Gemini), and zero for local checks", () => {
    expect(estimateCost("google", "gemini-nano-banana-2.1", { totalTokenCount: 5 }, 1)).toBeNull();
    expect(estimateCost("local", "yunet", undefined)!.costUsd).toBe(0);
  });
});

describe("render cost", () => {
  it("sums every call, and says when a call had no price", () => {
    const m = (provider: string, model: string, usd: number | null) => ({ provider, model, latencyMs: 10, cost: usd === null ? null : { costUsd: usd, estimate: true as const, basis: "" } });
    const meta = renderCost([{ step: "policy", metrics: m("meta", "muse-spark-1.3", 0.0002) }, { step: "generate", metrics: m("meta", "muse-image-1.0", 0.01) }, { step: "consent", metrics: m("meta", "sam-3.1", 0.0025) }]);
    expect(meta).toMatchObject({ costUsd: 0.0127, estimate: true, complete: true });
    expect(meta.calls.map((c) => c.step)).toEqual(["policy", "generate", "consent"]);
    expect(renderCost([{ step: "generate", metrics: m("google", "gemini-nano-banana-2.1", null) }])).toMatchObject({ costUsd: 0, complete: false });
  });
});

describe("showing model cost", () => {
  it("is on by default and off with SHOW_MODEL_COST=0", () => {
    const saved = process.env.SHOW_MODEL_COST;
    delete process.env.SHOW_MODEL_COST;
    expect(showModelCost()).toBe(true);
    process.env.SHOW_MODEL_COST = "0";
    expect(showModelCost()).toBe(false);
    if (saved === undefined) delete process.env.SHOW_MODEL_COST;
    else process.env.SHOW_MODEL_COST = saved;
  });
});
