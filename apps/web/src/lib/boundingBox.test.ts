import { describe, it, expect } from "vitest";
import {
  normalizeBoxToPercent,
  severityColorForLabel,
  isDrawableBox,
} from "./boundingBox";

describe("normalizeBoxToPercent", () => {
  it("converts an absolute box on a 320x180 frame to percent coords", () => {
    const result = normalizeBoxToPercent(
      { xmin: 32, ymin: 18, xmax: 160, ymax: 90 },
      320,
      180,
    );
    expect(result.left).toBeCloseTo(10);
    expect(result.top).toBeCloseTo(10);
    expect(result.width).toBeCloseTo(40);
    expect(result.height).toBeCloseTo(40);
  });

  it("clamps coordinates within [0, 100]", () => {
    const r = normalizeBoxToPercent(
      { xmin: -10, ymin: -10, xmax: 400, ymax: 300 },
      320,
      180,
    );
    expect(r.left).toBe(0);
    expect(r.top).toBe(0);
    expect(r.left + r.width).toBeLessThanOrEqual(100);
    expect(r.top + r.height).toBeLessThanOrEqual(100);
  });

  it("returns zero-sized box when frame dimensions are zero", () => {
    const r = normalizeBoxToPercent(
      { xmin: 0, ymin: 0, xmax: 100, ymax: 100 },
      0,
      0,
    );
    expect(r.width).toBe(0);
    expect(r.height).toBe(0);
  });
});

describe("severityColorForLabel", () => {
  it("returns the threat-high color family for drone-like labels", () => {
    expect(severityColorForLabel("airplane", true)).toMatch(/(#|threat-high|rgb)/i);
  });

  it("returns the accent color for non-drone-like detections", () => {
    const color = severityColorForLabel("person", false);
    expect(color).toMatch(/(#|accent|rgb)/i);
  });

  it("never returns the same color for drone-like vs non-drone-like", () => {
    expect(severityColorForLabel("airplane", true)).not.toBe(
      severityColorForLabel("person", false),
    );
  });
});

describe("isDrawableBox", () => {
  it("is true for boxes with positive area", () => {
    expect(isDrawableBox({ left: 10, top: 10, width: 5, height: 5 })).toBe(true);
  });

  it("is false for zero width", () => {
    expect(isDrawableBox({ left: 10, top: 10, width: 0, height: 5 })).toBe(false);
  });

  it("is false for zero height", () => {
    expect(isDrawableBox({ left: 10, top: 10, width: 5, height: 0 })).toBe(false);
  });

  it("is false for sub-pixel boxes after normalization", () => {
    expect(
      isDrawableBox({ left: 0, top: 0, width: 0.0001, height: 0.0001 }),
    ).toBe(false);
  });
});
