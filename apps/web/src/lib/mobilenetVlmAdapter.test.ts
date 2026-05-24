import { describe, it, expect } from "vitest";
import {
  formatMobilenetSummary,
  buildVlmFocusHint,
  type MobilenetClassification,
} from "./mobilenetVlmAdapter";

describe("formatMobilenetSummary", () => {
  it("returns 'No activity' when no predictions provided", () => {
    expect(formatMobilenetSummary([])).toBe("No activity");
  });

  it("returns 'No activity' when top prediction probability is below 0.10", () => {
    const preds: MobilenetClassification[] = [
      { className: "Egyptian cat", probability: 0.08 },
    ];
    expect(formatMobilenetSummary(preds)).toBe("No activity");
  });

  it("uses only the top className when one strong prediction", () => {
    const preds: MobilenetClassification[] = [
      { className: "airliner", probability: 0.88 },
      { className: "warplane", probability: 0.04 },
    ];
    const out = formatMobilenetSummary(preds);
    expect(out.toLowerCase()).toContain("airliner");
    expect(out.toLowerCase()).not.toContain("warplane");
  });

  it("includes secondary classes when their probability is >= 0.15", () => {
    const preds: MobilenetClassification[] = [
      { className: "airliner", probability: 0.55 },
      { className: "warplane", probability: 0.32 },
      { className: "wing", probability: 0.18 },
      { className: "sky", probability: 0.05 },
    ];
    const out = formatMobilenetSummary(preds).toLowerCase();
    expect(out).toContain("airliner");
    expect(out).toContain("warplane");
    expect(out).toContain("wing");
    expect(out).not.toContain("sky");
  });

  it("collapses comma-separated synonym lists in className to the first synonym", () => {
    const preds: MobilenetClassification[] = [
      { className: "tabby, tabby cat", probability: 0.74 },
    ];
    expect(formatMobilenetSummary(preds).toLowerCase()).toContain("tabby");
    expect(formatMobilenetSummary(preds).toLowerCase()).not.toContain("tabby cat");
  });

  it("never returns an empty string for non-empty input above threshold", () => {
    const preds: MobilenetClassification[] = [
      { className: "screen", probability: 0.5 },
    ];
    const out = formatMobilenetSummary(preds);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("buildVlmFocusHint", () => {
  it("returns an empty string when detectors list is empty", () => {
    expect(buildVlmFocusHint([])).toBe("");
  });

  it("returns a focus prefix mentioning each detector", () => {
    const out = buildVlmFocusHint(["drone", "fire"]);
    expect(out.toLowerCase()).toContain("drone");
    expect(out.toLowerCase()).toContain("fire");
  });
});
