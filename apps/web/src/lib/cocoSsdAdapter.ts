import type { DetectorRawOutput } from "./droneDetectorEngine";

export type CocoSsdPrediction = {
  bbox: [number, number, number, number];
  class: string;
  score: number;
};

export function cocoSsdToDetectorRaw(
  preds: CocoSsdPrediction[],
): DetectorRawOutput[] {
  return preds.map((p) => {
    const [x, y, w, h] = p.bbox;
    return {
      label: p.class,
      score: p.score,
      box: { xmin: x, ymin: y, xmax: x + w, ymax: y + h },
    };
  });
}
