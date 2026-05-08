/// <reference lib="webworker" />
import type { DroneClassification, DroneTrack, Location } from "@overwatch/schemas";

type ClassifyMessage = { type: "classify"; track: DroneTrack; locations: Location[] };
type ClassificationMessage = { type: "classification"; data: DroneClassification };

// NLI candidate labels mapped to the DroneClassification enum
const NLI_LABELS = [
  "hostile armed drone conducting an attack or kamikaze mission",
  "neutral drone conducting surveillance or reconnaissance",
  "unknown or benign drone with no threat profile",
] as const;

type NliLabel = typeof NLI_LABELS[number];

const LABEL_MAP: Record<NliLabel, DroneClassification["label"]> = {
  "hostile armed drone conducting an attack or kamikaze mission": "hostile",
  "neutral drone conducting surveillance or reconnaissance": "neutral",
  "unknown or benign drone with no threat profile": "unknown",
};

let classifier: any = null;
let modelReady = false;
let modelLoading = false;

async function ensureModel() {
  if (modelReady || modelLoading) return;
  modelLoading = true;
  const { pipeline } = await import("@huggingface/transformers") as any;
  classifier = await pipeline(
    "zero-shot-classification",
    "Xenova/nli-deberta-v3-xsmall",
    { device: "wasm", dtype: "q8" },
  );
  modelReady = true;
}

// Start loading immediately so it's ready when tracks arrive
ensureModel().catch(() => undefined);

const lastHistLen = new Map<string, number>();

function deg2rad(d: number) { return (d * Math.PI) / 180; }

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function evasionScore(history: DroneTrack["positionHistory"]): number {
  const slice = history.slice(-10);
  if (slice.length < 3) return 0;
  const headings: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    const prev = slice[i - 1]!.geo;
    const cur = slice[i]!.geo;
    const dLat = cur.lat - prev.lat;
    const dLon = cur.lon - prev.lon;
    if (Math.abs(dLat) < 1e-9 && Math.abs(dLon) < 1e-9) continue;
    const h = ((Math.atan2(dLon, dLat) * 180) / Math.PI + 360) % 360;
    headings.push(h);
  }
  if (headings.length < 2) return 0;
  const deltas: number[] = [];
  for (let i = 1; i < headings.length; i++) deltas.push(angleDiff(headings[i]!, headings[i - 1]!));
  const mean = deltas.reduce((s, d) => s + d, 0) / deltas.length;
  const variance = deltas.reduce((s, d) => s + (d - mean) ** 2, 0) / deltas.length;
  return Math.min(1, Math.sqrt(variance) / 90);
}

function loiterRatio(history: DroneTrack["positionHistory"]): number {
  const slice = history.slice(-20);
  if (slice.length < 2) return 0;
  let pathLen = 0;
  for (let i = 1; i < slice.length; i++) {
    const p = slice[i - 1]!.geo;
    const c = slice[i]!.geo;
    pathLen += haversineM(p.lat, p.lon, c.lat, c.lon);
  }
  if (pathLen < 1) return 1;
  const first = slice[0]!.geo;
  const last = slice[slice.length - 1]!.geo;
  const net = haversineM(first.lat, first.lon, last.lat, last.lon);
  return Math.max(0, Math.min(1, 1 - net / pathLen));
}

function descentRate(history: DroneTrack["positionHistory"], locations: Location[]): number {
  if (history.length < 2) return 0;
  const recent = history.slice(-5);
  const alts = recent.map((h) => h.geo.alt ?? 0);
  const altChange = alts[alts.length - 1]! - alts[0]!;
  const timeSec = (recent.length - 1) * 1;
  if (locations.length === 0 || timeSec === 0) return -altChange / timeSec;
  const last = recent[recent.length - 1]!.geo;
  let minDist = Infinity;
  for (const loc of locations) {
    const d = haversineM(last.lat, last.lon, loc.geo.lat, loc.geo.lon);
    if (d < minDist) minDist = d;
  }
  const proximity = minDist < 500 ? 1.5 : 1;
  return (-altChange / Math.max(1, timeSec)) * proximity;
}

function payloadStability(history: DroneTrack["positionHistory"]): number {
  const slice = history.slice(-10);
  if (slice.length < 2) return 1;
  const alts = slice.map((h) => h.geo.alt ?? 0);
  const mean = alts.reduce((s, a) => s + a, 0) / alts.length;
  const variance = alts.reduce((s, a) => s + (a - mean) ** 2, 0) / alts.length;
  return Math.max(0, Math.min(1, 1 - Math.sqrt(variance) / 10));
}

function predictPath(track: DroneTrack): Array<{ lat: number; lon: number; alt?: number }> {
  const geo = track.positionHistory.at(-1)?.geo ?? track.geo;
  const vLat = (track.velocityMs * Math.cos(deg2rad(track.headingDeg))) / 111_000;
  const vLon = (track.velocityMs * Math.sin(deg2rad(track.headingDeg))) / (111_000 * Math.cos(deg2rad(geo.lat)));
  const path: Array<{ lat: number; lon: number; alt?: number }> = [];
  let lat = geo.lat;
  let lon = geo.lon;
  let alt = geo.alt;
  for (let i = 0; i < 30; i++) {
    lat += vLat;
    lon += vLon;
    if (alt !== undefined) alt -= Math.max(0, track.velocityMs * 0.01);
    path.push(alt !== undefined ? { lat, lon, alt } : { lat, lon });
  }
  return path;
}

function nearestTarget(path: Array<{ lat: number; lon: number }>, locations: Location[]): string | undefined {
  if (locations.length === 0 || path.length === 0) return undefined;
  let minDist = Infinity;
  let target: string | undefined;
  for (const loc of locations) {
    for (const pt of path) {
      const d = haversineM(pt.lat, pt.lon, loc.geo.lat, loc.geo.lon);
      if (d < minDist) {
        minDist = d;
        target = loc.label;
      }
    }
  }
  return minDist < 2000 ? target : undefined;
}

function buildDescription(
  evasion: number,
  loiter: number,
  descent: number,
  stability: number,
  swarm: boolean,
  track: DroneTrack,
  locations: Location[],
): string {
  const parts: string[] = [];
  const alt = track.geo.alt ?? 0;
  const speed = Math.round(track.velocityMs);

  parts.push(`A drone flying at ${Math.round(alt)}m altitude at ${speed} m/s.`);

  if (evasion > 0.6) parts.push("It shows highly erratic, evasive maneuvering.");
  else if (evasion > 0.3) parts.push("It shows some heading variability.");

  if (loiter > 0.7) parts.push("It is loitering — traveling far from its starting point relative to path length.");
  else if (loiter > 0.4) parts.push("It shows partial loitering behavior.");

  if (descent > 2) parts.push("It is descending rapidly toward the ground or a target.");
  else if (descent > 0.5) parts.push("It is slowly descending.");

  if (stability < 0.4) parts.push("Altitude is highly unstable, suggesting payload release or damage.");

  if (swarm) parts.push("It is part of a correlated swarm of multiple drones.");


  if (locations.length > 0) {
    const last = track.positionHistory.at(-1)?.geo ?? track.geo;
    let minDist = Infinity;
    let nearest = "";
    for (const loc of locations) {
      const d = haversineM(last.lat, last.lon, loc.geo.lat, loc.geo.lon);
      if (d < minDist) { minDist = d; nearest = loc.label; }
    }
    if (minDist < 2000) parts.push(`It is ${Math.round(minDist)}m from ${nearest}.`);
  }

  return parts.join(" ");
}

self.onmessage = async (ev: MessageEvent<ClassifyMessage>) => {
  const { type, track, locations } = ev.data;
  if (type !== "classify") return;

  // Debounce: skip if positionHistory hasn't grown by ≥ 3 since last run
  const prev = lastHistLen.get(track.id) ?? 0;
  if (track.positionHistory.length - prev < 3) return;
  lastHistLen.set(track.id, track.positionHistory.length);

  const history = track.positionHistory;
  const evasion = evasionScore(history);
  const loiter = loiterRatio(history);
  const descent = descentRate(history, locations);
  const stability = payloadStability(history);
  const swarm = track.swarmCorrelated;

  await ensureModel();

  const description = buildDescription(evasion, loiter, descent, stability, swarm, track, locations);

  const result = await classifier(description, [...NLI_LABELS]);
  // result.labels sorted by score descending
  const topLabel: NliLabel = result.labels[0] as NliLabel;
  const topScore: number = result.scores[0] as number;
  const label = LABEL_MAP[topLabel] ?? "unknown";

  // aggressionScore: probability assigned to the hostile label
  const hostileIdx = result.labels.indexOf("hostile armed drone conducting an attack or kamikaze mission");
  const aggressionScore: number = hostileIdx >= 0 ? result.scores[hostileIdx] : 0;

  const predictedPath = predictPath(track);
  const estimatedTarget = nearestTarget(predictedPath, locations);

  const classification: DroneClassification = {
    trackId: track.id,
    label,
    aggressionScore,
    confidence: Math.min(1, topScore * (history.length / 20)),
    evasionScore: evasion,
    loiterRatio: loiter,
    descentRate: descent,
    payloadStability: stability,
    swarmCorrelated: swarm,
    predictedPath,
    estimatedTarget,
    computedAt: new Date().toISOString(),
  };

  self.postMessage({ type: "classification", data: classification } satisfies ClassificationMessage);
};
