/**
 * The Muse Spark brand agent and output reviewer, with fetch mocked: nothing is sent to Meta.
 * Fail closed: a refusal, invalid JSON or a schema miss never becomes a proposal or a pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LicenceDoc } from "@/lib/model";
import { PLAN_SCHEMA, POLICY_SCHEMA, REVIEW_SCHEMA, SparkError, sparkAnswer, sparkBrandAgent, sparkRequest, sparkReviewer } from "./spark";

const now = Date.now();
const licence = (o: Partial<LicenceDoc> = {}): LicenceDoc => ({
  id: "L1", requestId: "R1", brandId: "b", brandName: "Brew & Co.", creatorId: "c", creatorName: "Maya Okafor", use: "advertising",
  start: now - 86_400_000, end: now + 7 * 86_400_000, maxRenders: 4, renderCount: 0, pricePerImage: 200, createdAt: now - 86_400_000, ...o,
});
const metrics = { provider: "meta" as const, model: "muse-spark-1.3", latencyMs: 1, cost: null };
const answer = (o: unknown) => ({ model: "muse-spark-1.3", status: "completed", usage: { input_tokens: 1000, output_tokens: 200, input_tokens_details: { cached_tokens: 0 } }, output: [{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text: typeof o === "string" ? o : JSON.stringify(o) }] }] });
const shot = { prompt: "Medium close-up of the person holding a ceramic cup in a sunlit café.", rationale: "Shows the product in use.", subject: "the person", action: "holding the cup", setting: "café", wardrobe: "knit", composition: "space right", style: "photoreal" };
const brief = { idea: "spring coffee promo", product: "ceramic cup", setting: "sunlit café", mood: "warm" as const, aspect: "1:1" as const };

let fetchMock: ReturnType<typeof vi.fn>;
const bodies = () => fetchMock.mock.calls.map((c) => JSON.parse(String(c[1].body)));
const saved = { ...process.env };
beforeEach(() => {
  process.env.MODEL_API_KEY = "test-key";
  delete process.env.MUSE_SPARK_REASONING_EFFORT;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  process.env = { ...saved };
  vi.unstubAllGlobals();
});
const reply = (o: unknown) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(answer(o)), { status: 200 }));

describe("Muse Spark request", () => {
  it("asks for schema-constrained JSON, stores nothing, doesn't stream", () => {
    const b = sparkRequest({ name: "policy_check", instructions: "i", content: [{ type: "input_text", text: "t" }], schema: POLICY_SCHEMA, temperature: 0 });
    expect(b).toMatchObject({ model: "muse-spark-1.3", instructions: "i", store: false, stream: false, temperature: 0, max_output_tokens: 4096, text: { format: { type: "json_schema", name: "policy_check", strict: true } } });
    expect(b.input[0]).toMatchObject({ type: "message", role: "user" });
    expect("reasoning" in b).toBe(false);
    process.env.MUSE_SPARK_REASONING_EFFORT = "low";
    expect(sparkRequest({ name: "x", instructions: "i", content: [], schema: POLICY_SCHEMA, temperature: 0 })).toMatchObject({ reasoning: { effort: "low" } });
    process.env.MUSE_SPARK_REASONING_EFFORT = "turbo";
    expect(() => sparkRequest({ name: "x", instructions: "i", content: [], schema: POLICY_SCHEMA, temperature: 0 })).toThrow(/MUSE_SPARK_REASONING_EFFORT/);
  });
  it("uses only schemas strict mode accepts: objects closed, every property required", () => {
    const strictOk = (s: typeof PLAN_SCHEMA): boolean =>
      s.type !== "object" ? (s.items ? strictOk(s.items) : true) : s.additionalProperties === false && Object.keys(s.properties ?? {}).every((k) => s.required?.includes(k)) && Object.values(s.properties ?? {}).every(strictOk);
    for (const s of [POLICY_SCHEMA, PLAN_SCHEMA, REVIEW_SCHEMA]) expect(strictOk(s)).toBe(true);
  });
});

describe("Muse Spark answers fail closed", () => {
  const res = (content: unknown[]) => ({ output: [{ type: "message", content }] }) as never;
  it("a refusal is MODEL_REFUSED", () => {
    expect(() => sparkAnswer(res([{ type: "refusal", refusal: "I can't help with that." }]), POLICY_SCHEMA, metrics)).toThrow(/^MODEL_REFUSED: the model refused: I can't help with that\./);
  });
  it("invalid JSON or a schema miss is INVALID_MODEL_OUTPUT", () => {
    expect(() => sparkAnswer(res([{ type: "output_text", text: "{not json" }]), POLICY_SCHEMA, metrics)).toThrow(/^INVALID_MODEL_OUTPUT: .*not valid JSON/);
    expect(() => sparkAnswer(res([{ type: "output_text", text: JSON.stringify({ banned: ["violence"], fitsCategory: "yes", reason: "" }) }]), POLICY_SCHEMA, metrics)).toThrow(/^INVALID_MODEL_OUTPUT: .*schema/);
  });
  it("no answer is NO_MODEL_OUTPUT", () => {
    expect(() => sparkAnswer({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }, POLICY_SCHEMA, metrics)).toThrow(/^NO_MODEL_OUTPUT: .*max_output_tokens/);
  });
  it("a conforming answer comes back typed", () => {
    expect(sparkAnswer(res([{ type: "output_text", text: JSON.stringify({ banned: [], fitsCategory: true, reason: "ok" }) }]), POLICY_SCHEMA, metrics)).toEqual({ banned: [], fitsCategory: true, reason: "ok" });
  });
});

describe("Muse Spark brand agent", () => {
  it("checkPolicy sends the shared screening instruction and returns the verdict with its cost", async () => {
    reply({ banned: [], fitsCategory: true, reason: "a product ad" });
    const v = await sparkBrandAgent.checkPolicy("Holding a cup", licence());
    const b = bodies()[0];
    expect(b.instructions).toMatch(/^You screen prompts for an image generator/);
    expect(b.input[0].content[0].text).toBe("Licence category: Advertising\nPrompt: Holding a cup");
    expect(v).toMatchObject({ banned: [], fitsCategory: true, metrics: { provider: "meta", cost: { estimate: true } } });
  });

  it("checkPolicy throws on a bad answer, so the filter refuses", async () => {
    reply("{}");
    await expect(sparkBrandAgent.checkPolicy("Holding a cup", licence())).rejects.toBeInstanceOf(SparkError);
  });

  it("planShots: never calls the model for a revoked licence or a banned brief", async () => {
    const revoked = await sparkBrandAgent.planShots(brief, licence({ revokedAt: now - 1 }));
    expect(revoked.decisions[0]).toMatchObject({ allowed: false, code: "LICENCE_REVOKED" });
    const banned = await sparkBrandAgent.planShots({ ...brief, text: "a campaign rally: vote for our candidate" }, licence());
    expect(banned.decisions[0]).toMatchObject({ allowed: false, code: "BANNED_USE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("planShots: the model proposes, the code decides (renders left), and the creator's name is never sent or kept", async () => {
    reply({ refused: false, refusalReason: "", shots: [shot, { ...shot, prompt: "Maya Okafor smiling with the cup in a studio." }, { ...shot, prompt: "Third shot in a park with the cup." }] });
    const plan = await sparkBrandAgent.planShots({ ...brief, shots: 3 }, licence({ maxRenders: 4, renderCount: 2 }));
    expect(JSON.stringify(bodies()[0])).not.toMatch(/Maya|Okafor/);
    expect(bodies()[0].input[0].content[0].text).toMatch(/Shots wanted: 2/);
    expect(plan.shots).toHaveLength(2);
    expect(plan.shots[1].prompt).toBe("the person smiling with the cup in a studio.");
    expect(plan.decisions.map((d) => d.allowed)).toEqual([true, true]);
    expect(plan.shots[0].details?.action).toBe("holding the cup");
  });

  it("planShots: a model refusal is MODEL_REFUSED; a bad answer is refused, not guessed", async () => {
    reply({ refused: true, refusalReason: "A news report is editorial, not advertising.", shots: [] });
    expect((await sparkBrandAgent.planShots(brief, licence())).decisions[0]).toMatchObject({ allowed: false, code: "MODEL_REFUSED", explanation: expect.stringMatching(/editorial, not advertising/) });
    reply({ refused: false, shots: "lots" });
    const bad = await sparkBrandAgent.planShots(brief, licence());
    expect(bad.shots).toEqual([]);
    expect(bad.decisions[0]).toMatchObject({ allowed: false, code: "POLICY_CHECK_FAILED", explanation: expect.stringMatching(/INVALID_MODEL_OUTPUT/) });
  });

  it("planShots: a proposed shot with banned words is refused by the keyword rules", async () => {
    reply({ refused: false, refusalReason: "", shots: [{ ...shot, prompt: "The person posing as a famous senator at a campaign rally." }] });
    const plan = await sparkBrandAgent.planShots(brief, licence());
    expect(plan.decisions[0]).toMatchObject({ allowed: false, code: "BANNED_USE" });
  });
});

describe("Muse Spark output reviewer", () => {
  const image = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mime: "image/png" as const };
  const s = { id: "s1", prompt: "Holding a ceramic cup in a sunlit café", aspect: "1:1" as const, rationale: "" };
  const review = (o: Record<string, unknown>) => ({ productMatches: true, settingMatches: true, fitsLicensedUse: true, bannedContent: [], notes: "Looks right.", ...o });

  it("passes a matching image, sending it only as a data URL", async () => {
    reply(review({}));
    const r = await sparkReviewer.review(image, s, licence());
    expect(r).toMatchObject({ verdict: "pass", findings: [] });
    const parts = bodies()[0].input[0].content;
    expect(parts[1]).toEqual({ type: "input_image", image_url: "data:image/png;base64,iVBORw==" });
    expect(bodies()[0]).toMatchObject({ store: false, temperature: 0 });
  });
  it("flags a brief mismatch (wrong product or setting)", async () => {
    reply(review({ productMatches: false }));
    expect(await sparkReviewer.review(image, s, licence())).toMatchObject({ verdict: "flag", reasons: expect.arrayContaining(["The product isn't the one in the shot."]) });
  });
  it("blocks a licence violation (banned content or outside the licensed use)", async () => {
    reply(review({ bannedContent: ["political"] }));
    expect((await sparkReviewer.review(image, s, licence())).verdict).toBe("block");
    reply(review({ fitsLicensedUse: false, productMatches: false }));
    expect((await sparkReviewer.review(image, s, licence())).verdict).toBe("block");
  });
  it("throws on a bad answer, so the pipeline blocks the image", async () => {
    reply({ productMatches: "maybe" });
    await expect(sparkReviewer.review(image, s, licence())).rejects.toThrow(/^INVALID_MODEL_OUTPUT/);
  });
});

describe("Muse Spark alternative shot", () => {
  const prev = { id: "shot-1", prompt: "Maya Okafor at a campaign rally with the cup", aspect: "1:1" as const, rationale: "" };
  it("sends the earlier shot and the reason (no creator name), and returns the alternative under the same id", async () => {
    reply({ refused: false, refusalReason: "", shot });
    const r = await sparkBrandAgent.reviseShot!(prev, { code: "BANNED_USE", explanation: "Refused: political." }, licence());
    const sent = JSON.stringify(bodies()[0]);
    expect(sent).toMatch(/Reason \(BANNED_USE\): Refused: political\./);
    expect(sent).not.toMatch(/Maya|Okafor/);
    expect(bodies()[0].text.format).toMatchObject({ name: "shot_alternative", strict: true });
    expect(r.shot).toMatchObject({ id: "shot-1", prompt: shot.prompt, aspect: "1:1" });
  });
  it("returns no shot when the model declines or answers badly (fail closed)", async () => {
    reply({ refused: true, refusalReason: "Nothing compliant keeps this brief.", shot });
    expect(await sparkBrandAgent.reviseShot!(prev, { code: "BANNED_USE", explanation: "x" }, licence())).toMatchObject({ shot: null, note: "Nothing compliant keeps this brief." });
    reply({ refused: false });
    expect(await sparkBrandAgent.reviseShot!(prev, { code: "BANNED_USE", explanation: "x" }, licence())).toMatchObject({ shot: null, note: expect.stringMatching(/^INVALID_MODEL_OUTPUT/) });
  });
});
