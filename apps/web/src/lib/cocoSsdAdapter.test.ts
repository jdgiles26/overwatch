import { describe, it, expect } from "vitest";
import { cocoSsdToDetectorRaw, type CocoSsdPrediction } from "./cocoSsdAdapter";

describe("cocoSsdToDetectorRaw", () => {
  it("returns empty array for empty input", () => {
    expect(cocoSsdToDetectorRaw([])).toEqual([]);
  });

  it("converts a single prediction with [x, y, width, height] to {xmin, ymin, xmax, ymax}", () => {
    const preds: CocoSsdPrediction[] = [
      { bbox: [10, 20, 90, 60], class: "airplane", score: 0.92 },
    ];
    const result = cocoSsdToDetectorRaw(preds);
    expect(result).toHaveLength(1);
    const d = result[0]!;
    expect(d.label).toBe("airplane");
    expect(d.score).toBeCloseTo(0.92);
    expect(d.box.xmin).toBe(10);
    expect(d.box.ymin).toBe(20);
    expect(d.box.xmax).toBe(10 + 90);
    expect(d.box.ymax).toBe(20 + 60);
  });

  it("handles multiple predictions and preserves order", () => {
    const preds: CocoSsdPrediction[] = [
      { bbox: [0, 0, 50, 50], class: "person", score: 0.5 },
      { bbox: [100, 100, 30, 30], class: "kite", score: 0.7 },
    ];
    const result = cocoSsdToDetectorRaw(preds);
    expect(result.map((d) => d.label)).toEqual(["person", "kite"]);
  });

  it("does not mutate the input predictions", () => {
    const preds: CocoSsdPrediction[] = [
      { bbox: [1, 2, 3, 4], class: "bird", score: 0.4 },
    ];
    const snap = JSON.stringify(preds);
    cocoSsdToDetectorRaw(preds);
    expect(JSON.stringify(preds)).toBe(snap);
  });
});
