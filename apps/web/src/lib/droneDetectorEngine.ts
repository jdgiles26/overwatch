// Raw output shape from Transformers.js object-detection pipelines (DETR, YOLOS, etc.).
// All of these models return the same { label, score, box } structure.
export type DetectorRawOutput = {
  label: string;
  score: number;
  box: { xmin: number; ymin: number; xmax: number; ymax: number };
};

/** @deprecated Use DetectorRawOutput. Kept for backwards compatibility. */
export type YoloRawOutput = DetectorRawOutput;

export type ParsedDetection = {
  label: string;
  score: number;
  box: { xmin: number; ymin: number; xmax: number; ymax: number };
  isDroneLike: boolean;
};

export type DroneCvEvent = {
  cameraId: string;
  title: string;
  summary: string;
  severity: "info" | "low" | "moderate" | "high" | "extreme";
  geo?: { lat: number; lon: number };
  detections: ParsedDetection[];
  inferenceMs: number;
};

// COCO classes that small fixed-wing or rotor aircraft often get classified as.
export const DRONE_COCO_CLASSES = ["airplane", "bird", "kite"] as const;

export function isDroneLikeLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return DRONE_COCO_CLASSES.some((c) => c === lower);
}

export function parseDetections(
  raw: DetectorRawOutput[],
  minScore = 0.3,
): ParsedDetection[] {
  return raw
    .filter((d) => d.score >= minScore)
    .map((d) => ({
      label: d.label,
      score: d.score,
      box: d.box,
      isDroneLike: isDroneLikeLabel(d.label),
    }));
}

/** @deprecated Use parseDetections. Kept for backwards compatibility. */
export const parseYoloDetections = parseDetections;

export function buildDroneCvEvent(
  cameraId: string,
  detections: ParsedDetection[],
  geo?: { lat: number; lon: number },
  inferenceMs = 0,
): DroneCvEvent {
  const droneDetections = detections.filter((d) => d.isDroneLike);
  const hasDrone = droneDetections.length > 0;

  if (detections.length === 0) {
    return {
      cameraId,
      title: `Camera ${cameraId}: No drone detections`,
      summary: "No objects detected in frame.",
      severity: "info",
      geo,
      detections: [],
      inferenceMs,
    };
  }

  const labels = detections.map((d) => `${d.label}(${(d.score * 100).toFixed(0)}%)`).join(", ");
  const severity = hasDrone ? "high" : "moderate";
  const title = hasDrone
    ? `Camera ${cameraId}: DRONE-LIKE — ${droneDetections.map((d) => d.label).join(", ")}`
    : `Camera ${cameraId}: ${labels}`;

  return {
    cameraId,
    title,
    summary: labels,
    severity,
    geo,
    detections,
    inferenceMs,
  };
}
