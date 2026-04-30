/// <reference lib="webworker" />

let lastFrame: ImageData | null = null;
let lastDetectAt: Record<string, number> = {};
const COOLDOWN_MS = 6_000;

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg.type !== "frame") return;
  const data: ImageData = msg.data;
  const detectors: string[] = msg.detectors ?? [];
  const now = Date.now();
  const findings: any[] = [];

  if (detectors.includes("motion")) {
    const score = motionScore(data, lastFrame);
    if (score > 0.04 && (now - (lastDetectAt.motion ?? 0)) > COOLDOWN_MS) {
      lastDetectAt.motion = now;
      findings.push({ label: "motion", confidence: Math.min(1, score * 6) });
    }
  }
  if (detectors.includes("fire")) {
    const score = fireHeuristic(data);
    if (score > 0.05 && (now - (lastDetectAt.fire ?? 0)) > COOLDOWN_MS) {
      lastDetectAt.fire = now;
      findings.push({ label: "fire", confidence: Math.min(1, score * 5) });
    }
  }
  if (detectors.includes("person") || detectors.includes("vehicle") || detectors.includes("plate")) {
    // Heuristic placeholder: high-edge regions
    const score = edgeScore(data);
    if (score > 0.2 && (now - (lastDetectAt.shape ?? 0)) > COOLDOWN_MS) {
      lastDetectAt.shape = now;
      findings.push({ label: detectors[0]!, confidence: Math.min(1, score) });
    }
  }

  lastFrame = data;
  for (const f of findings) (self as any).postMessage({ type: "detection", ...f });
};

function motionScore(curr: ImageData, prev: ImageData | null): number {
  if (!prev || prev.data.length !== curr.data.length) return 0;
  let diff = 0;
  const data = curr.data;
  const p = prev.data;
  const step = 16;
  for (let i = 0; i < data.length; i += step) {
    const dr = Math.abs(data[i]! - p[i]!);
    const dg = Math.abs(data[i + 1]! - p[i + 1]!);
    const db = Math.abs(data[i + 2]! - p[i + 2]!);
    if (dr + dg + db > 80) diff++;
  }
  return diff / (data.length / step);
}

function fireHeuristic(d: ImageData): number {
  const data = d.data;
  let hits = 0;
  let total = 0;
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (r > 180 && g < 140 && b < 90 && r - b > 80) hits++;
    total++;
  }
  return hits / Math.max(1, total);
}

function edgeScore(d: ImageData): number {
  const data = d.data;
  const w = d.width;
  let edges = 0;
  let total = 0;
  for (let y = 1; y < d.height - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const i = (y * w + x) * 4;
      const right = i + 4;
      const lum = data[i]! + data[i + 1]! + data[i + 2]!;
      const lumR = data[right]! + data[right + 1]! + data[right + 2]!;
      if (Math.abs(lum - lumR) > 90) edges++;
      total++;
    }
  }
  return edges / Math.max(1, total);
}

export {};
