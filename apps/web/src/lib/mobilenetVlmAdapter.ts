export type MobilenetClassification = {
  className: string;
  probability: number;
};

const TOP_THRESHOLD = 0.1;
const SECONDARY_THRESHOLD = 0.15;

function firstSynonym(name: string): string {
  const idx = name.indexOf(",");
  return idx === -1 ? name : name.slice(0, idx);
}

export function formatMobilenetSummary(
  predictions: MobilenetClassification[],
): string {
  if (predictions.length === 0) return "No activity";
  const sorted = [...predictions].sort((a, b) => b.probability - a.probability);
  const top = sorted[0]!;
  if (top.probability < TOP_THRESHOLD) return "No activity";

  const topLabel = firstSynonym(top.className).trim();
  const secondary = sorted
    .slice(1)
    .filter((p) => p.probability >= SECONDARY_THRESHOLD)
    .map((p) => firstSynonym(p.className).trim())
    .filter((s) => s.length > 0 && s.toLowerCase() !== topLabel.toLowerCase());

  if (secondary.length === 0) {
    return `Scene resembles ${topLabel}.`;
  }
  return `Scene resembles ${topLabel}; also detected: ${secondary.join(", ")}.`;
}

export function buildVlmFocusHint(detectors: string[]): string {
  if (detectors.length === 0) return "";
  return `Watching for: ${detectors.join(", ")}.`;
}
