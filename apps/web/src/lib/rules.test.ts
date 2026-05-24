import { describe, it, expect } from "vitest";
import { newRule } from "./rules";

describe("newRule", () => {
  it("does not generate id (caller's responsibility / server-assigned)", () => {
    expect(newRule().id).toBeUndefined();
  });

  it("returns sane defaults", () => {
    const r = newRule();
    expect(r.label.length).toBeGreaterThan(0);
    expect(r.enabled).toBe(true);
    expect(r.notify.severityFloor).toBe("moderate");
    expect(r.condition.categories).toContain("weather");
    expect(r.condition.rateLimitMs).toBe(60_000);
  });
});
