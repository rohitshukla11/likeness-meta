import { describe, expect, it } from "vitest";
import { assertSupported, validate, type Schema } from "./jsonSchema";

const schema: Schema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "tags", "note"],
  properties: {
    ok: { type: "boolean" },
    tags: { type: "array", maxItems: 2, items: { type: "string", enum: ["a", "b"] } },
    note: { type: "string", maxLength: 5 },
  },
};

describe("model answer validation", () => {
  it("accepts a conforming answer", () => {
    expect(validate({ ok: true, tags: ["a"], note: "fine" }, schema)).toEqual([]);
  });
  it("lists every miss: wrong type, missing, extra, enum, lengths", () => {
    expect(validate({ ok: "yes", tags: ["a", "c", "b"], note: "too long", extra: 1 }, schema).sort()).toEqual(
      ["$.extra: not allowed", "$.note: longer than 5", "$.ok: expected boolean", "$.tags: more than 2 items", "$.tags[1]: not one of a, b"].sort(),
    );
    expect(validate({ ok: true, tags: [] }, schema)).toEqual(["$.note: missing"]);
    expect(validate([], schema)).toEqual(["$: expected object"]);
  });
  it("rejects schemas that use keywords it doesn't check", () => {
    expect(() => assertSupported({ type: "string", pattern: "x" } as unknown as Schema)).toThrow(/"pattern"/);
    expect(() => assertSupported(schema)).not.toThrow();
  });
});
