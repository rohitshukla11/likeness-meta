/**
 * SAM 3.1: the format (base85, the one_bit codec, the line grammar, the event stream) and the segmenter,
 * with fetch mocked. Fixtures for 0, 1 and 2+ people, a truncated stream and malformed records; every
 * failure must throw, so the consent gate blocks with GATE_ERROR. The one_bit fixtures are made with this
 * file's own encoder: they prove the decoder and encoder agree, not that they match Meta's encoder (the
 * first real call checks that, eval/fixtures/sam-response.txt).
 */
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runConsentGate } from "../../consentGate";
import { readPeople, samDetect, samRequest } from "./sam";
import { decodeOneBit, encodeOneBit, pack85, parseLine, readImageStream, SamFormatError, unpack85 } from "./samFormat";

let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const raster = (w: number, h: number, f: (x: number, y: number) => number) => Uint8Array.from({ length: w * h }, (_, i) => f(i % w, Math.floor(i / w)));
const blob = (w: number, h: number) => raster(w, h, (x, y) => ((x - w / 2) ** 2 / (w / 2.2) ** 2 + (y - h / 2) ** 2 / (h / 2.2) ** 2 < 1 ? 1 : 0));

const record = (id: number, x1: number, y1: number, x2: number, y2: number, W = 320, H = 334) => {
  const mw = x2 - x1 + 1;
  const mh = y2 - y1 + 1;
  return `${id}<|box;x1=${x1};y1=${y1};x2=${x2};y2=${y2};w=${W};h=${H}|><|mask;x=0;y=0;data=${mh},${mw},${encodeOneBit(blob(mw, mh), mw, mh)}|>`;
};
const sse = (...events: object[]) => events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const stream = (text: string | null, end: "completed" | "none" | "failed" = "completed") =>
  sse(
    { type: "response.created" },
    ...(text ? [{ type: "response.output_text.delta", delta: text }, { type: "response.output_text.done", text }] : []),
    ...(end === "completed" ? [{ type: "response.completed", response: { status: "completed" } }] : end === "failed" ? [{ type: "response.failed", response: { error: { message: "overloaded" } } }] : []),
  );
let image: { bytes: Uint8Array; mime: "image/png" };

beforeEach(async () => {
  image = { bytes: new Uint8Array(await sharp({ create: { width: 320, height: 334, channels: 3, background: "#ccc" } }).png().toBuffer()), mime: "image/png" };
});

describe("base85 (Meta's alphabet)", () => {
  it("round-trips every tail length, and refuses invalid or non-canonical payloads", () => {
    for (let n = 0; n <= 9; n++) {
      const b = Uint8Array.from({ length: n }, () => Math.floor(rand() * 256));
      expect([...unpack85(pack85(b))]).toEqual([...b]);
    }
    expect(() => unpack85("0000")).toThrow(/length prefix/);
    expect(() => unpack85(pack85(Uint8Array.of(1, 2, 3)) + "x")).toThrow(SamFormatError);
    expect(() => unpack85("0000|")).toThrow(/invalid character/);
  });
});

describe("one_bit masks", () => {
  it("decode what was encoded, for shapes, noise and edge cases", () => {
    for (const [w, h, r] of [[1, 1, raster(1, 1, () => 1)], [60, 27, blob(60, 27)], [33, 41, raster(33, 41, () => (rand() < 0.3 ? 1 : 0))], [17, 9, raster(17, 9, () => 0)], [12, 12, raster(12, 12, () => 1)]] as const) {
      const payload = encodeOneBit(r, w, h);
      expect(payload.startsWith("!")).toBe(true);
      expect([...decodeOneBit(payload, w, h)]).toEqual([...r]);
    }
  });
  it("refuse a tampered payload, the wrong size, or a non-one_bit marker", () => {
    const p = encodeOneBit(blob(40, 30), 40, 30);
    const tampered = p.slice(0, -1) + (p.endsWith("A") ? "B" : "A");
    expect(() => decodeOneBit(tampered, 40, 30)).toThrow(SamFormatError);
    expect(() => decodeOneBit(p, 41, 30)).toThrow(SamFormatError);
    expect(() => decodeOneBit(`~${p.slice(1)}`, 40, 30)).toThrow(/one_bit/);
  });
});

describe("SAM stream fixtures", () => {
  it("0 people: completed with empty text", async () => {
    expect(await readPeople(stream(null), image)).toEqual({ count: 0, boxes: [], masks: [] });
  });

  it("1 person: count, the box normalised to the image, the mask decoded in memory", async () => {
    const p = await readPeople(stream(`<0f>${record(0, 100, 40, 219, 333)}`), image);
    expect(p.count).toBe(1);
    expect(p.boxes[0]).toMatchObject({ score: 1 });
    expect(p.boxes[0].x).toBeCloseTo(100 / 320, 6);
    expect(p.boxes[0].h).toBeCloseTo(293 / 334, 6);
    expect(p.masks[0]).toMatchObject({ width: 120, height: 294 });
    expect(p.masks[0].bits.length).toBe(120 * 294);
  });

  it("2+ people, with sparse object ids and confidences", async () => {
    const line = `<0f>${record(0, 10, 20, 90, 300)},${record(2, 120, 30, 200, 330).replace("h=334|>", "h=334;c=0.97|>")},${record(5, 230, 10, 310, 320)}`;
    const p = await readPeople(stream(line), image);
    expect(p.count).toBe(3);
    expect(p.boxes[1].score).toBeCloseTo(0.97, 6);
  });

  it("a truncated stream (no response.completed) throws", async () => {
    await expect(readPeople(stream(`<0f>${record(0, 100, 40, 219, 333)}`, "none"), image)).rejects.toThrow(/before response.completed/);
  });

  it("a failed response throws", async () => {
    await expect(readPeople(stream(null, "failed"), image)).rejects.toThrow(/SAM failed: overloaded/);
  });

  it("malformed records throw: a missing field, stray text, a broken token, an unknown token or key, a lossless mask", () => {
    const ok = record(0, 100, 40, 219, 333);
    for (const bad of [
      `<0f>${ok.replace(";y2=333", "")}`,
      `<0f>${ok} trailing`,
      `<0f>${ok.replace("|><|mask", "<|mask")}`,
      `<0f>${ok},1<|point;x=1;y=2|>`,
      `<0f>${ok.replace("w=320", "w=320;z=1")}`,
      `<0f>${ok.replace(",!", ",~")}`,
      `${ok}`,
      `<0f>0<|box;x1=1;y1=1;x2=999;y2=5;w=320;h=334|><|mask;x=0;y=0;data=1,1,!x|>`,
    ])
      expect(() => parseLine(bad)).toThrow(SamFormatError);
  });

  it("a size other than the image sent, or a non-JSON event, throws", async () => {
    await expect(readPeople(stream(`<0f>${record(0, 10, 10, 50, 50, 640, 668)}`), image)).rejects.toThrow(/reported a 640×668 image/);
    expect(() => readImageStream("data: {not json\n\n")).toThrow(/isn't JSON/);
  });
});

describe("SAM segmenter", () => {
  const saved = process.env.MODEL_API_KEY;
  beforeEach(() => {
    process.env.MODEL_API_KEY = "test-key";
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.MODEL_API_KEY;
    else process.env.MODEL_API_KEY = saved;
    vi.unstubAllGlobals();
  });

  it("sends the concept and the image as a data URL, streamed, one_bit masks, no file upload", () => {
    const b = samRequest(image);
    expect(b).toMatchObject({ model: "sam-3.1", stream: true, metadata: { mask_encoding: "one_bit" } });
    expect(b.input[0].content[0]).toEqual({ type: "input_text", text: "person" });
    expect(b.input[0].content[1].image_url).toMatch(/^data:image\/png;base64,/);
    expect(JSON.stringify(b)).not.toMatch(/file_id|https?:\/\//);
  });

  it("detects people from the stream, with the estimated cost ($0.0025), and never calls /files", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream(`<0f>${record(0, 10, 20, 90, 300)},${record(1, 120, 30, 200, 330)}`), { status: 200, headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    const p = await samDetect(image);
    expect(p.count).toBe(2);
    expect(p.metrics).toMatchObject({ provider: "meta", model: "sam-3.1", cost: { costUsd: 0.0025 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/responses$/);
    expect(fetchMock.mock.calls[0][1].headers.Accept).toBe("text/event-stream");
  });

  it("the consent gate blocks with GATE_ERROR on a broken stream", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream("<0f>0<|box;oops|>"), { status: 200 })));
    const r = await runConsentGate(image, [new Float32Array([1])], { detectPeople: (img) => samDetect(img) });
    expect(r).toMatchObject({ passed: false, code: "GATE_ERROR" });
  });
});
