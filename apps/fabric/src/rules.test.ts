import { describe, it, expect } from "vitest";
import { normalizeRuleId } from "./rules.js";

describe("normalizeRuleId", () => {
  it("keeps a non-empty id", () => {
    expect(normalizeRuleId("rule_abc")).toBe("rule_abc");
  });

  it("mints a fresh id for empty string", () => {
    const id = normalizeRuleId("");
    expect(id).toMatch(/^rule_[a-f0-9]{10}$/);
  });

  it("mints a fresh id for whitespace-only string", () => {
    const id = normalizeRuleId("   ");
    expect(id).toMatch(/^rule_[a-f0-9]{10}$/);
  });

  it("mints a fresh id for undefined / null / non-string", () => {
    expect(normalizeRuleId(undefined)).toMatch(/^rule_[a-f0-9]{10}$/);
    expect(normalizeRuleId(null)).toMatch(/^rule_[a-f0-9]{10}$/);
    expect(normalizeRuleId(123)).toMatch(/^rule_[a-f0-9]{10}$/);
  });

  it("yields distinct ids on successive empty-string calls", () => {
    const a = normalizeRuleId("");
    const b = normalizeRuleId("");
    expect(a).not.toBe(b);
  });
});
