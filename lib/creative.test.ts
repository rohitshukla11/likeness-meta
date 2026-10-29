import { describe, expect, it } from "vitest";
import { stillRules } from "./creative";

describe("image prompt rules", () => {
  it("always appends the framing rules and the aspect guidance to stills", () => {
    expect(stillRules("9:16")).toMatch(/full head and face visible/);
    expect(stillRules("9:16")).toMatch(/centre third/);
    expect(stillRules("1:1")).toMatch(/No text, logos or watermarks/);
  });
});
