/**
 * SAM 3.1's output format, read strictly (https://dev.meta.ai/docs/sam/reading-segmentation; the
 * meta-sam-parser package on PyPI was the reference for the format, no code taken from it):
 *
 *   events  response.output_text.delta carries the text; response.completed ends it. response.failed,
 *           error, response.incomplete or a refusal is a failure; so is a stream that ends before
 *           response.completed. Zero matches: completed with empty text.
 *   text    one line per frame (an image is one line, frame <0f>):
 *             line   ::= "<" INT "f>" record ("," record)*
 *             record ::= INT "<|box;x1=;y1=;x2=;y2=;w=;h=[;c=]|>" "<|mask;x=0;y=0[;c=];data=H,W,ENC PAYLOAD|>"
 *   masks   ENC "!" (one_bit): PAYLOAD is Meta's base85 (a 5-character length prefix, then 4 bytes per 5
 *           characters) of an adaptive binary range coder over the H×W raster, each pixel predicted from
 *           12 neighbours. Decoded, then re-encoded and compared, so a payload is accepted only in its
 *           canonical form. ENC "~" (lossless) isn't requested and is refused.
 *
 * Anything else (an unknown token or key, a malformed number, a truncated stream) throws SamFormatError:
 * the consent gate then blocks with GATE_ERROR. Pure: no I/O.
 */

export class SamFormatError extends Error {}
const fail = (m: string): never => {
  throw new SamFormatError(m);
};

// ---------------------------------------------------------------- base85 (Meta's alphabet and packing)

const EXCLUDED = new Set(['"', "\\", ",", ";", "<", ">", "|"]);
const ALPHABET = Array.from({ length: 0x7f - 0x21 }, (_, i) => String.fromCharCode(0x21 + i)).filter((c) => !EXCLUDED.has(c));
const RADIX = 85;
const PREFIX = 5;
const VALUE = new Map(ALPHABET.slice(0, RADIX).map((c, i) => [c, i]));
const digit = (c: string) => VALUE.get(c) ?? fail("mask payload has an invalid character");

export function pack85(bytes: Uint8Array): string {
  const out: string[] = [];
  let n = bytes.length;
  const prefix: string[] = [];
  for (let i = 0; i < PREFIX; i++) {
    prefix.unshift(ALPHABET[n % RADIX]);
    n = Math.floor(n / RADIX);
  }
  if (n !== 0) fail("mask payload too large");
  out.push(...prefix);
  const five = (v: number) => {
    const d = [0, 0, 0, 0, 0];
    for (let i = 4; i >= 0; i--) {
      d[i] = v % RADIX;
      v = (v - d[i]) / RADIX;
    }
    return d;
  };
  const full = bytes.length - (bytes.length % 4);
  for (let o = 0; o < full; o += 4) out.push(...five(bytes[o] * 0x1000000 + bytes[o + 1] * 0x10000 + bytes[o + 2] * 0x100 + bytes[o + 3]).map((d) => ALPHABET[d]));
  const rem = bytes.length - full;
  if (rem > 0) {
    let v = 0;
    for (let i = 0; i < 4; i++) v = v * 256 + (i < rem ? bytes[full + i] : 0);
    out.push(...five(v).slice(0, rem + 1).map((d) => ALPHABET[d]));
  }
  return out.join("");
}

export function unpack85(payload: string): Uint8Array {
  if (payload.length < PREFIX) fail("mask payload has no length prefix");
  let length = 0;
  for (const c of payload.slice(0, PREFIX)) length = length * RADIX + digit(c);
  const rem = length % 4;
  if (payload.length !== PREFIX + Math.floor(length / 4) * 5 + (rem === 0 ? 0 : rem + 1)) fail("mask payload length doesn't match its prefix");
  const out = new Uint8Array(length);
  let src = PREFIX;
  const full = length - rem;
  for (let dst = 0; dst < full; dst += 4, src += 5) {
    let v = 0;
    for (let i = 0; i < 5; i++) v = v * RADIX + digit(payload[src + i]);
    if (v > 0xffffffff) fail("mask payload group out of range");
    out[dst] = (v >>> 24) & 0xff;
    out[dst + 1] = (v >>> 16) & 0xff;
    out[dst + 2] = (v >>> 8) & 0xff;
    out[dst + 3] = v & 0xff;
  }
  if (rem > 0) {
    let v = 0;
    for (let i = 0; i < 5; i++) v = v * RADIX + (i < rem + 1 ? digit(payload[src + i]) : RADIX - 1);
    if (v > 0xffffffff) fail("mask payload tail out of range");
    for (let i = 0; i < rem; i++) out[full + i] = (v >>> (24 - i * 8)) & 0xff;
  }
  if (pack85(out) !== payload) fail("mask payload isn't in canonical form");
  return out;
}

// ---------------------------------------------------------------- one_bit raster: adaptive binary range coder

const TOP = 1 << 24;
const BOTTOM = 1 << 16;
const INCREMENT = 14;
const COUNT_LIMIT = 4096;
const CONTEXTS = 1 << 12;
const PADDING = 2;
const u32 = (v: number) => v >>> 0;

function context(r: Uint8Array, p: number, prior: number, earlier: number): number {
  return (
    r[p - 1] | (r[p - 2] << 1) | (r[prior - 2] << 2) | (r[prior - 1] << 3) | (r[prior] << 4) | (r[prior + 1] << 5) | (r[prior + 2] << 6) |
    (r[earlier - 2] << 7) | (r[earlier - 1] << 8) | (r[earlier] << 9) | (r[earlier + 1] << 10) | (r[earlier + 2] << 11)
  );
}

function updateCounts(counts: Uint16Array, offset: number, bit: number) {
  counts[offset + bit] = counts[offset + bit] + INCREMENT;
  if (counts[offset] + counts[offset + 1] >= COUNT_LIMIT) {
    counts[offset] = counts[offset] >> 1 || 1;
    counts[offset + 1] = counts[offset + 1] >> 1 || 1;
  }
}

/** Walk the raster in order, giving each pixel's context-model counts to `step`, which returns the bit. */
function walk(width: number, height: number, step: (zero: number, one: number, index: number) => number) {
  const counts = new Uint16Array(CONTEXTS * 2).fill(1);
  const pw = width + 2 * PADDING;
  const padded = new Uint8Array(pw * (height + PADDING));
  for (let y = 0; y < height; y++) {
    const row = (y + PADDING) * pw + PADDING;
    for (let x = 0; x < width; x++) {
      const p = row + x;
      const offset = context(padded, p, p - pw, p - 2 * pw) << 1;
      const bit = step(counts[offset], counts[offset + 1], y * width + x);
      padded[p] = bit;
      updateCounts(counts, offset, bit);
    }
  }
}

export function encodeOneBit(raster: Uint8Array, width: number, height: number): string {
  let low = 0;
  let range = 0xffffffff;
  const out: number[] = [];
  const encode = (cumulative: number, frequency: number, total: number) => {
    const scaled = Math.floor(range / total);
    low = u32(low + scaled * cumulative);
    range = scaled * frequency;
    for (;;) {
      if (u32(low ^ u32(low + range)) < TOP) {
        /* top byte settled */
      } else if (range < BOTTOM) range = u32(-low) & (BOTTOM - 1);
      else break;
      out.push((low >>> 24) & 0xff);
      low = u32(low << 8);
      range = u32(range << 8);
    }
  };
  walk(width, height, (zero, one, i) => {
    const bit = raster[i];
    if (bit !== 0 && bit !== 1) fail("mask raster isn't binary");
    if (bit === 0) encode(0, zero, zero + one);
    else encode(zero, one, zero + one);
    return bit;
  });
  for (let i = 0; i < 4; i++) {
    out.push((low >>> 24) & 0xff);
    low = u32(low << 8);
  }
  return `!${pack85(Uint8Array.from(out))}`;
}

/** A one_bit payload ("!…") → a row-major H×W raster of 0 and 1; refused unless canonical. */
export function decodeOneBit(payload: string, width: number, height: number): Uint8Array {
  if (!payload.startsWith("!")) fail("mask isn't one_bit (expected !)");
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width * height <= 1 << 26)) fail("mask dimensions are invalid");
  const input = unpack85(payload.slice(1));
  if (input.length < 4) fail("mask payload has no finalization");
  let pos = 0;
  const read = () => (pos < input.length ? input[pos++] : fail("mask payload ended early"));
  let low = 0;
  let range = 0xffffffff;
  let code = 0;
  for (let i = 0; i < 4; i++) code = u32(code * 256 + read());
  const out = new Uint8Array(width * height);
  walk(width, height, (zero, one, i) => {
    const total = zero + one;
    const scaled = Math.floor(range / total);
    if (scaled === 0) fail("mask payload has an invalid coding state");
    const v = Math.min(Math.floor(u32(code - low) / scaled), total - 1);
    const bit = v < zero ? 0 : 1;
    low = u32(low + scaled * (bit === 0 ? 0 : zero));
    range = scaled * (bit === 0 ? zero : one);
    for (;;) {
      if (u32(low ^ u32(low + range)) < TOP) {
        /* top byte settled */
      } else if (range < BOTTOM) range = u32(-low) & (BOTTOM - 1);
      else break;
      code = u32(code * 256 + read());
      low = u32(low << 8);
      range = u32(range << 8);
    }
    out[i] = bit;
    return bit;
  });
  if (encodeOneBit(out, width, height) !== payload) fail("mask payload isn't canonical");
  return out;
}

// ---------------------------------------------------------------- the line grammar

export type SamBox = { x1: number; y1: number; x2: number; y2: number; w: number; h: number; c?: number };
export type SamRecord = { id: number; box: SamBox; mask: { height: number; width: number; encoding: "one_bit"; payload: string; c?: number } };
export type SamFrame = { frame: number; records: SamRecord[] };

const INT = /^\d+$/;
const DECIMAL = /^\d+(\.\d+)?$/;
const int = (v: string | undefined, what: string) => (v !== undefined && INT.test(v) ? Number(v) : fail(`${what} isn't a whole number`));

/** "k=v;k=v" with exactly the allowed keys (required ones present, optional c a decimal 0–1). */
function fields(body: string, required: string[], token: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 1) fail(`malformed field in ${token}`);
    const k = part.slice(0, eq);
    if (!required.includes(k) && k !== "c") fail(`unknown key "${k}" in ${token}`);
    if (k in out) fail(`repeated key "${k}" in ${token}`);
    out[k] = part.slice(eq + 1);
  }
  for (const k of required) if (!(k in out)) fail(`missing ${k} in ${token}`);
  if ("c" in out && !(DECIMAL.test(out.c) && Number(out.c) <= 1)) fail(`confidence isn't a number from 0 to 1 in ${token}`);
  return out;
}

/** Read "<|name;…|>" at `at`; returns its body and where it ends. */
function token(line: string, at: number, name: "box" | "mask"): { body: string; end: number } {
  const open = `<|${name};`;
  if (!line.startsWith(open, at)) fail(`expected ${open} at ${at}`);
  const close = line.indexOf("|>", at + open.length);
  if (close < 0) fail(`unterminated ${name} token`);
  return { body: line.slice(at + open.length, close), end: close + 2 };
}

export function parseLine(line: string): SamFrame {
  const m = /^<(\d+)f>/.exec(line) ?? fail("line doesn't start with a frame marker <Nf>");
  const frame = Number(m[1]);
  const records: SamRecord[] = [];
  let at = m[0].length;
  for (;;) {
    const id = /^\d+/.exec(line.slice(at)) ?? fail(`expected an object id at ${at}`);
    at += id[0].length;
    const b = token(line, at, "box");
    const bf = fields(b.body, ["x1", "y1", "x2", "y2", "w", "h"], "box");
    const box: SamBox = { x1: int(bf.x1, "x1"), y1: int(bf.y1, "y1"), x2: int(bf.x2, "x2"), y2: int(bf.y2, "y2"), w: int(bf.w, "w"), h: int(bf.h, "h"), ...(bf.c ? { c: Number(bf.c) } : {}) };
    if (!(box.w > 0 && box.h > 0 && box.x1 <= box.x2 && box.y1 <= box.y2 && box.x2 <= box.w && box.y2 <= box.h)) fail("box outside its image");
    const k = token(line, b.end, "mask");
    const dataAt = k.body.indexOf(";data=");
    if (dataAt < 0) fail("mask has no data");
    const mf = fields(k.body.slice(0, dataAt), ["x", "y"], "mask");
    if (mf.x !== "0" || mf.y !== "0") fail("mask origin isn't 0,0");
    const data = /^(\d+),(\d+),(.)(.*)$/s.exec(k.body.slice(dataAt + 6)) ?? fail("mask data isn't H,W,<enc><payload>");
    if (data[3] !== "!") fail(`mask encoding "${data[3]}" not requested (one_bit only)`);
    records.push({ id: Number(id[0]), box, mask: { height: Number(data[1]), width: Number(data[2]), encoding: "one_bit", payload: data[3] + data[4], ...(mf.c ? { c: Number(mf.c) } : {}) } });
    at = k.end;
    if (at === line.length) break;
    if (line[at] !== ",") fail(`unexpected text after a record at ${at}`);
    at++;
  }
  if (new Set(records.map((r) => r.id)).size !== records.length) fail("repeated object id on one frame");
  return { frame, records };
}

// ---------------------------------------------------------------- the event stream

export type SamEvent = { type?: string; delta?: unknown; text?: unknown; response?: { error?: { message?: string }; incomplete_details?: { reason?: string } }; error?: { message?: string }; message?: string };

/** Fold the Responses events into the output text; throws on failure, refusal or a stream that never completed. */
export function foldEvents(events: SamEvent[]): string {
  let text = "";
  let finalText: string | null = null;
  for (const e of events) {
    switch (e.type) {
      case "response.output_text.delta":
        text += typeof e.delta === "string" ? e.delta : fail("text delta without text");
        break;
      case "response.output_text.done":
        finalText = typeof e.text === "string" ? e.text : fail("text done without text");
        break;
      case "response.refusal.delta":
      case "response.refusal.done":
        fail("SAM refused the request");
        break;
      case "response.failed":
        fail(`SAM failed: ${e.response?.error?.message ?? "no message"}`);
        break;
      case "response.incomplete":
        fail(`SAM's response is incomplete: ${e.response?.incomplete_details?.reason ?? "no reason"}`);
        break;
      case "error":
        fail(`SAM stream error: ${e.error?.message ?? e.message ?? "no message"}`);
        break;
      case "response.completed":
        if (finalText !== null && finalText !== text) fail("the final text doesn't match the streamed text");
        return text;
      default:
      // Lifecycle events (response.created, response.in_progress, output items) carry nothing to read.
    }
  }
  return fail("the stream ended before response.completed");
}

/** Server-sent events → their JSON payloads ("[DONE]" ignored); a payload that isn't JSON throws. */
export function parseSse(raw: string): SamEvent[] {
  const out: SamEvent[] = [];
  for (const block of raw.replace(/\r\n/g, "\n").split("\n\n")) {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data || data === "[DONE]") continue;
    try {
      out.push(JSON.parse(data) as SamEvent);
    } catch {
      fail("a stream event isn't JSON");
    }
  }
  return out;
}

/** The whole read: events → text → frames (an image: at most one line, frame 0). */
export function readImageStream(raw: string): SamFrame | null {
  const text = foldEvents(parseSse(raw));
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return null; // zero matches
  if (lines.length > 1) fail("an image should give one line");
  const f = parseLine(lines[0].trim());
  if (f.frame !== 0) fail("an image's line should be frame 0");
  return f;
}
