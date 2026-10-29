/**
 * The Muse Image adapter and the Meta API client, with fetch mocked: nothing is sent to Meta.
 * The first test must fail if image search, web search or shell is ever turned on.
 */
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backoff, MetaApiError, metaPost } from "./client";
import { MUSE_IMAGE_SIZES, MUSE_IMAGE_TOOL_SWITCHES, museImageConfig, museImageGenerator, museImageRequest, museImageResult } from "./image";

const png = async (color = "#c9a27e") => new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: color } }).png().toBuffer());
const jpegRef = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), mime: "image/jpeg" as const };
const productRef = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9]), mime: "image/png" as const };
type Body = ReturnType<typeof museImageRequest>;
type Part = { type: string; text?: string; image_url?: string };
const parts = (b: Body) => b.input[0].content as Part[];

const saved = { ...process.env };
beforeEach(() => {
  process.env.MODEL_API_KEY = "test-key";
  for (const k of Object.keys(process.env)) if (k.startsWith("MUSE_IMAGE_")) delete process.env[k];
});
afterEach(() => {
  process.env = { ...saved };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Muse Image request", () => {
  it("never turns on image search, web search or shell", () => {
    expect(MUSE_IMAGE_TOOL_SWITCHES).toEqual({ enable_image_search: false, enable_web_search: false, enable_shell: false });
    expect(Object.isFrozen(MUSE_IMAGE_TOOL_SWITCHES)).toBe(true);
    for (const product of [undefined, productRef]) {
      const tool = museImageRequest([jpegRef], "Holding a cup", { aspectRatio: "1:1" }, museImageConfig(), product).tools[0] as Record<string, unknown>;
      const switches = Object.entries(tool).filter(([k]) => k.startsWith("enable_"));
      expect(switches.map(([k]) => k).sort()).toEqual(["enable_image_search", "enable_shell", "enable_web_search"]);
      expect(switches.every(([, v]) => v === false)).toBe(true);
    }
  });

  it("stores nothing, doesn't stream, asks for PNG, and uses the console defaults", () => {
    const b = museImageRequest([jpegRef], "Holding a cup", { aspectRatio: "1:1" }, museImageConfig());
    expect(b).toMatchObject({ model: "muse-image-1.0", store: false, stream: false, temperature: 0.6, top_p: 0.9, max_output_tokens: 2048 });
    expect(b.tools[0]).toMatchObject({ type: "image_generation", output_format: "png", reasoning_strength: "high" });
    expect(b.input[0]).toMatchObject({ type: "message", role: "user" });
  });

  it("sends images only as base64 data URLs, never as links", () => {
    const b = museImageRequest([jpegRef, jpegRef], "Holding a cup", { aspectRatio: "1:1" }, museImageConfig(), productRef);
    const images = parts(b).filter((p) => p.type === "input_image");
    expect(images).toHaveLength(3);
    for (const i of images) expect(i.image_url).toMatch(/^data:image\/(jpeg|png);base64,/);
    expect(JSON.stringify(b)).not.toMatch(/https?:\/\//);
  });

  it("multiImage: each reference, then the product photo last, named in the text", () => {
    const p = parts(museImageRequest([jpegRef, jpegRef], "Holding the bottle", { aspectRatio: "16:9" }, museImageConfig(), productRef));
    expect(p.map((x) => x.type)).toEqual(["input_text", "input_image", "input_image", "input_text", "input_image", "input_text"]);
    expect(p[3].text).toBe("The brand's product photo:");
    expect(p[4].image_url).toMatch(/^data:image\/png;base64,/);
    expect(p[5].text).toMatch(/last image \(after those 2\) is the brand's product photo/);
    expect(p[5].text).toMatch(/Brief: Holding the bottle/);
  });

  it("maps the aspect to the tool's size, and leaves it to the model when none is given", () => {
    const size = (a?: "1:1" | "16:9" | "9:16") => (museImageRequest([jpegRef], "x y z", { aspectRatio: a }, museImageConfig()).tools[0] as { size: string }).size;
    expect([size("1:1"), size("16:9"), size("9:16"), size(undefined)]).toEqual([MUSE_IMAGE_SIZES["1:1"], "1792x1008", "1008x1792", "auto"]);
  });

  it("takes temperature, top_p, max tokens and reasoning strength from configuration, and rejects bad values", () => {
    process.env.MUSE_IMAGE_TEMPERATURE = "0.3";
    process.env.MUSE_IMAGE_TOP_P = "1";
    process.env.MUSE_IMAGE_MAX_OUTPUT_TOKENS = "1024";
    process.env.MUSE_IMAGE_REASONING_STRENGTH = "low";
    expect(museImageConfig()).toMatchObject({ temperature: 0.3, topP: 1, maxOutputTokens: 1024, reasoningStrength: "low" });
    process.env.MUSE_IMAGE_REASONING_STRENGTH = "medium";
    expect(() => museImageConfig()).toThrow(/"high" or "low"/);
    process.env.MUSE_IMAGE_REASONING_STRENGTH = "high";
    process.env.MUSE_IMAGE_TOP_P = "2";
    expect(() => museImageConfig()).toThrow(/MUSE_IMAGE_TOP_P/);
  });
});

describe("Muse Image response", () => {
  it("picks the image_generation_call by type, not position", async () => {
    const img = await png();
    const r = await museImageResult({ output: [{ type: "reasoning", summary: [] }, { type: "message", content: [] }, { type: "image_generation_call", status: "completed", result: Buffer.from(img).toString("base64") }] });
    expect(r.mime).toBe("image/png");
    expect(Buffer.from(r.bytes).equals(Buffer.from(img))).toBe(true);
  });
  it("converts a non-PNG result to PNG", async () => {
    const webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } }).webp().toBuffer();
    const r = await museImageResult({ output: [{ type: "image_generation_call", result: webp.toString("base64") }] });
    expect(Buffer.from(r.bytes).subarray(1, 4).toString()).toBe("PNG");
  });
  it("says why there is no image", async () => {
    await expect(museImageResult({ status: "incomplete", incomplete_details: { reason: "content_filter" }, output: [{ type: "message", content: [{ type: "output_text", text: "I can't help with that." }] }] })).rejects.toThrow(/no image \(status incomplete; reason content_filter; model said: I can't help with that\.\)/);
  });
});

describe("Meta API client", () => {
  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

  it("retries a 429, waiting at least Retry-After, then succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(429, { error: { message: "slow down" } }, { "retry-after": "2" })).mockResolvedValueOnce(reply(200, { ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const waits: number[] = [];
    expect(await metaPost("/responses", {}, { sleep: async (ms) => void waits.push(ms) })).toEqual({ ok: 1 });
    expect(waits[0]).toBeGreaterThanOrEqual(2000);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer test-key");
  });
  it("doesn't retry a 400, and keeps Meta's message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(400, { error: { code: "invalid_request", message: "image models only support the image_generation tool" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(metaPost("/responses", {})).rejects.toThrow(/HTTP 400 invalid_request: image models only support/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("gives up after the retries on 503", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => reply(503, {})));
    await expect(metaPost("/responses", {}, { retries: 2, sleep: async () => {} })).rejects.toBeInstanceOf(MetaApiError);
  });
  it("refuses without MODEL_API_KEY", async () => {
    delete process.env.MODEL_API_KEY;
    await expect(metaPost("/responses", {})).rejects.toThrow(/MODEL_API_KEY is not set/);
  });
  it("backs off 500 ms, doubling, with jitter", () => {
    expect(backoff(0, null)).toBeGreaterThanOrEqual(500);
    expect(backoff(0, null)).toBeLessThan(750);
    expect(backoff(2, null)).toBeGreaterThanOrEqual(2000);
    expect(backoff(0, "5")).toBe(5000);
  });
});

describe("Muse Image generator", () => {
  it("returns the image with its cost ($0.01) and reasoning strength, and logs nothing", async () => {
    const img = await png();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ model: "muse-image-1.0", status: "completed", usage: { input_tokens: 900, output_tokens: 40 }, output: [{ type: "image_generation_call", result: Buffer.from(img).toString("base64") }] }), { status: 200 })));
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info"), vi.spyOn(console, "debug")];
    const out = await museImageGenerator.edit([jpegRef], "Holding a cup", { aspectRatio: "1:1", quality: "full", licenceId: "L", renderIndex: 0 });
    expect(out.mime).toBe("image/png");
    expect(out.metrics).toMatchObject({ provider: "meta", model: "muse-image-1.0", cost: { costUsd: 0.01, estimate: true }, settings: { reasoning_strength: "high", size: "1024x1024" } });
    for (const l of logs) expect(l).not.toHaveBeenCalled();
  });
});
