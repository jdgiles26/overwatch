import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import type { DroneTrack, IngestEvent } from "@overwatch/schemas";

const COASTING_THRESHOLD_MS = 5_000;
const EXPIRY_THRESHOLD_MS = 60_000;
const SWARM_HEADING_TOLERANCE_DEG = 15;
const SWARM_SPEED_TOLERANCE_RATIO = 0.25;
const SWARM_WINDOW_MS = 10_000;

type KalmanState = { lat: number; lon: number; vLat: number; vLon: number };

function kalmanPredict(s: KalmanState, dtMs: number): KalmanState {
  const dt = dtMs / 1000;
  return { lat: s.lat + s.vLat * dt, lon: s.lon + s.vLon * dt, vLat: s.vLat, vLon: s.vLon };
}

function kalmanUpdate(predicted: KalmanState, measLat: number, measLon: number): KalmanState {
  const K = 0.6; // fixed gain
  return {
    lat: predicted.lat + K * (measLat - predicted.lat),
    lon: predicted.lon + K * (measLon - predicted.lon),
    vLat: predicted.vLat + K * ((measLat - predicted.lat) * 0.1),
    vLon: predicted.vLon + K * ((measLon - predicted.lon) * 0.1),
  };
}

function headingDeg(vLat: number, vLon: number): number {
  const deg = (Math.atan2(vLon, vLat) * 180) / Math.PI;
  return (deg + 360) % 360;
}

function velocityMs(vLat: number, vLon: number): number {
  // 1 deg lat ≈ 111 km; crude but sufficient for heading/speed estimates
  const vLatMs = vLat * 111_000;
  const vLonMs = vLon * 111_000;
  return Math.sqrt(vLatMs ** 2 + vLonMs ** 2);
}

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

type TrackEntry = {
  track: DroneTrack;
  kalman: KalmanState;
  lastSeenAt: number;
};

export class DroneTrackAggregator extends EventEmitter {
  private entries = new Map<string, TrackEntry>();
  private trackCounter = 0;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  start() {
    this.intervalHandle = setInterval(() => {
      this.tick();
      this.correlateSwarms();
    }, 1_000);
  }

  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  process(event: IngestEvent) {
    if (event.category !== "drone") return;
    const nodeId = (event.payload?.nodeId as string | undefined) ?? event.connectorId;
    const now = Date.now();
    const ts = new Date().toISOString();

    let entry = this.entries.get(nodeId);
    if (!entry) {
      this.trackCounter++;
      const id = `DT-${this.trackCounter}`;
      const geo = event.geo ?? { lat: 0, lon: 0 };
      const initialKalman: KalmanState = { lat: geo.lat, lon: geo.lon, vLat: 0, vLon: 0 };
      const track: DroneTrack = {
        id,
        nodeId,
        geo,
        rangeM: (event.payload?.rangeM as number | undefined) ?? 0,
        rangeErrorM: (event.payload?.rangeErrorM as number | undefined) ?? 0,
        positionHistory: [{ geo, ts }],
        velocityMs: 0,
        headingDeg: 0,
        severity: event.severity,
        state: "active",
        lastDetectionAt: ts,
        swarmCorrelated: false,
      };
      entry = { track, kalman: initialKalman, lastSeenAt: now };
      this.entries.set(nodeId, entry);
    } else {
      const geo = event.geo ?? entry.track.geo;
      const dtMs = now - entry.lastSeenAt;
      const predicted = kalmanPredict(entry.kalman, dtMs);
      const updated = kalmanUpdate(predicted, geo.lat, geo.lon);
      entry.kalman = updated;
      entry.lastSeenAt = now;

      const smoothedGeo = { lat: updated.lat, lon: updated.lon, ...(geo.alt !== undefined ? { alt: geo.alt } : {}) };
      entry.track.geo = smoothedGeo;
      entry.track.velocityMs = velocityMs(updated.vLat, updated.vLon);
      entry.track.headingDeg = headingDeg(updated.vLat, updated.vLon);
      entry.track.state = "active";
      entry.track.coastingSince = undefined;
      entry.track.lastDetectionAt = ts;
      entry.track.severity = event.severity;
      entry.track.positionHistory = [
        ...entry.track.positionHistory.slice(-99),
        { geo: smoothedGeo, ts },
      ];
      if (event.payload?.rangeM !== undefined) {
        entry.track.rangeM = event.payload.rangeM as number;
        entry.track.rangeErrorM = (event.payload.rangeErrorM as number | undefined) ?? Math.round((event.payload.rangeM as number) * 0.2);
      }
    }

    this.emit("track", { ...entry.track });
  }

  tick() {
    const now = Date.now();
    for (const [nodeId, entry] of this.entries) {
      const elapsed = now - entry.lastSeenAt;
      if (entry.track.state === "active" && elapsed > COASTING_THRESHOLD_MS) {
        entry.track.state = "coasting";
        entry.track.coastingSince = new Date().toISOString();
        this.emit("track", { ...entry.track });
      } else if (entry.track.state === "coasting") {
        const coastingMs = now - new Date(entry.track.coastingSince!).getTime();
        if (coastingMs > EXPIRY_THRESHOLD_MS) {
          entry.track.state = "expired";
          this.emit("track", { ...entry.track });
          this.entries.delete(nodeId);
        }
      }
    }
  }

  correlateSwarms() {
    const active = [...this.entries.values()].filter(e => e.track.state !== "expired");
    const now = Date.now();
    for (const e of active) e.track.swarmCorrelated = false;

    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i]!;
        const b = active[j]!;
        const recentA = now - a.lastSeenAt < SWARM_WINDOW_MS;
        const recentB = now - b.lastSeenAt < SWARM_WINDOW_MS;
        if (!recentA || !recentB) continue;

        const headA = a.track.headingDeg;
        const headB = b.track.headingDeg;
        const speedA = a.track.velocityMs;
        const speedB = b.track.velocityMs;
        const avgSpeed = (speedA + speedB) / 2 || 1;

        const headingMatch = angleDiff(headA, headB) <= SWARM_HEADING_TOLERANCE_DEG;
        const speedMatch = Math.abs(speedA - speedB) / avgSpeed <= SWARM_SPEED_TOLERANCE_RATIO;

        if (headingMatch && speedMatch) {
          a.track.swarmCorrelated = true;
          b.track.swarmCorrelated = true;
          this.emit("track", { ...a.track });
          this.emit("track", { ...b.track });
        }
      }
    }
  }

  activeTracks(): DroneTrack[] {
    return [...this.entries.values()]
      .filter(e => e.track.state !== "expired")
      .map(e => ({ ...e.track }));
  }
}

export const aggregator = new DroneTrackAggregator();
