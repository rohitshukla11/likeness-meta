/**
 * The Google adapters send exactly likeness-ai's Gemini requests: the renderer's parts and prompt, the
 * filter's system instruction and settings. Gemini is mocked; nothing is called.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LicenceDoc } from "@/lib/model";

const generateContent = vi.fn();
vi.mock("../../gemini", () => ({
  generateContent: (...a: unknown[]) => generateContent(...a),
  geminiModels: { filter: () => "gemini-filter-test", image: () => "gemini-image-test" },
  vertexConfigured: () => true,
}));

const { geminiImageGenerator } = await import("./image");
const { geminiBrandAgent } = await import("./agent");

const png1x1 = { inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" } };
const licence = { id: "L1", use: "advertising", creatorName: "Demo Person", renderCount: 0, maxRenders: 4, end: Date.now() + 86_400_000 } as LicenceDoc;
const ref = { bytes: new Uint8Array([1, 2, 3]), mime: "image/jpeg" as const };
const opts = { aspectRatio: "1:1" as const, quality: "full" as const, licenceId: "L1", renderIndex: 0 };
type Body = { contents: { parts: { text?: string; inlineData?: { mimeType: string } }[] }[]; generationConfig: Record<string, unknown>; systemInstruction?: { parts: { text: string }[] } };

beforeEach(() => generateContent.mockReset());

describe("Gemini ImageGenerator", () => {
  it("edit sends the references then the prompt, with no product line (as in likeness-ai)", async () => {
    generateContent.mockResolvedValue({ candidates: [{ content: { parts: [png1x1] } }], usageMetadata: { totalTokenCount: 9 } });
    const out = await geminiImageGenerator.edit([ref, ref], "Holding a cup", opts);
    const [model, body] = generateContent.mock.calls[0] as [string, Body];
    expect(model).toBe("gemini-image-test");
    const parts = body.contents[0].parts;
    expect(parts.map((p) => p.inlineData?.mimeType ?? "text")).toEqual(["image/jpeg", "image/jpeg", "text"]);
    expect(parts[2].text).toMatch(/^The 2 images show one real, consenting adult/);
    expect(parts[2].text).not.toMatch(/product photo/);
    expect(body.generationConfig).toMatchObject({ responseModalities: ["IMAGE"] });
    expect(out.metrics).toMatchObject({ provider: "google", model: "gemini-image-test", costUsd: null, usage: { totalTokenCount: 9 } });
  });

  it("multiImage adds the product photo after the references and says which image it is", async () => {
    generateContent.mockResolvedValue({ candidates: [{ content: { parts: [png1x1] } }] });
    await geminiImageGenerator.multiImage([ref], { bytes: new Uint8Array([9]), mime: "image/png" }, "Holding the bottle", opts);
    const parts = (generateContent.mock.calls[0][1] as Body).contents[0].parts;
    expect(parts.map((p) => p.inlineData?.mimeType ?? "text")).toEqual(["image/jpeg", "image/png", "text"]);
    expect(parts[2].text).toMatch(/last image \(after those 1\) is the brand's product photo/);
  });
});

describe("Gemini BrandAgent", () => {
  it("checkPolicy sends likeness-ai's classifier request and returns the verdict with metrics", async () => {
    generateContent.mockResolvedValue({ candidates: [{ content: { parts: [{ text: JSON.stringify({ banned: [], fitsCategory: true, reason: "ok" }) }] } }] });
    const v = await geminiBrandAgent.checkPolicy("Holding a cup", licence);
    const body = generateContent.mock.calls[0][1] as Body;
    expect(body.systemInstruction!.parts[0].text).toMatch(/^You screen prompts for an image generator/);
    expect(body.contents[0].parts[0].text).toBe("Licence category: Advertising\nPrompt: Holding a cup");
    expect(body.generationConfig).toMatchObject({ temperature: 0, responseMimeType: "application/json" });
    expect(v).toMatchObject({ banned: [], fitsCategory: true, metrics: { model: "gemini-filter-test" } });
  });

  it("checkPolicy throws on an unexpected shape (the filter then refuses)", async () => {
    generateContent.mockResolvedValue({ candidates: [{ content: { parts: [{ text: "{}" }] } }] });
    await expect(geminiBrandAgent.checkPolicy("x y z", licence)).rejects.toThrow(/unexpected shape/);
  });

  it("planShots: banned inputs are refused by code before any model call", async () => {
    const plan = await geminiBrandAgent.planShots({ idea: "vote for our candidate", product: "", setting: "", mood: "warm", aspect: "1:1" }, licence);
    expect(plan.shots).toEqual([]);
    expect(plan.decisions[0]).toMatchObject({ allowed: false, code: "BANNED_USE" });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("planShots: the model writes, the code decides each shot", async () => {
    const draft = { refused: false, refusalReason: "", subject: "s", action: "a", setting: "st", wardrobe: "w", composition: "c", style: "y", brief: "Medium close-up of the person holding a cup." };
    generateContent.mockResolvedValue({ candidates: [{ content: { parts: [{ text: JSON.stringify(draft) }] } }] });
    const plan = await geminiBrandAgent.planShots({ idea: "café", product: "cup", setting: "café", mood: "warm", aspect: "1:1", shots: 2 }, { ...licence, maxRenders: 1 });
    expect(plan.shots).toHaveLength(2);
    expect(plan.decisions.map((d) => [d.allowed, d.code])).toEqual([[true, null], [false, "OVER_CAP"]]);
  });
});
