import { describe, it, expect } from "vitest";
import { pearson, isSignificantCorrelation } from "./correlation.js";

const approx = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe("pearson", () => {
  it("returns 1.0 for two identical strictly-increasing series", () => {
    const xs = [1, 2, 3, 4, 5];
    expect(approx(pearson(xs, xs), 1)).toBe(true);
  });

  it("returns -1.0 for perfectly inverse series", () => {
    const xs = [1, 2, 3, 4, 5];
    const ys = [5, 4, 3, 2, 1];
    expect(approx(pearson(xs, ys), -1)).toBe(true);
  });

  it("returns a value near 0 for uncorrelated series", () => {
    // Two fixed, manually chosen vectors that are nearly orthogonal in
    // mean-centered space. Hard-coded to keep the test deterministic.
    const xs = [1, 2, 3, 4, 5, 6, 7, 8];
    const ys = [3, -1, 4, 1, -5, 9, 2, -6];
    const r = pearson(xs, ys);
    expect(Math.abs(r)).toBeLessThan(0.3);
  });

  it("throws on length mismatch", () => {
    expect(() => pearson([1, 2, 3], [1, 2])).toThrow(/length mismatch/);
  });

  it("throws on fewer than 2 samples", () => {
    expect(() => pearson([1], [1])).toThrow(/2 samples/);
  });

  it("returns NaN when either series has zero variance", () => {
    expect(Number.isNaN(pearson([1, 1, 1], [1, 2, 3]))).toBe(true);
    expect(Number.isNaN(pearson([1, 2, 3], [5, 5, 5]))).toBe(true);
  });

  it("agrees with hand-computed result on small case", () => {
    // x = [1,2,3,4], y = [2,4,6,8] => perfectly linear, r = 1
    expect(approx(pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1)).toBe(true);
    // x=[1,2,3,4], y=[1,3,2,5]; means 2.5 / 2.75
    // numerator = 5.5, denX = 5, denY = 8.75
    // r = 5.5 / sqrt(43.75) ≈ 0.8315218406202999
    const r = pearson([1, 2, 3, 4], [1, 3, 2, 5]);
    expect(approx(r, 0.8315218406202999, 1e-9)).toBe(true);
  });
});

describe("isSignificantCorrelation", () => {
  it("treats |r| >= 0.7 as significant by default", () => {
    expect(isSignificantCorrelation(0.7)).toBe(true);
    expect(isSignificantCorrelation(-0.85)).toBe(true);
    expect(isSignificantCorrelation(0.69)).toBe(false);
  });

  it("respects an explicit threshold", () => {
    expect(isSignificantCorrelation(0.55, 0.5)).toBe(true);
    expect(isSignificantCorrelation(0.45, 0.5)).toBe(false);
  });

  it("treats NaN as not significant", () => {
    expect(isSignificantCorrelation(NaN)).toBe(false);
  });
});
