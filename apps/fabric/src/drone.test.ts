import { describe, it, expect, vi, beforeEach } from "vitest";
import { DroneTrackAggregator } from "./drone.js";
import type { IngestEvent } from "@overwatch/schemas";

function makeEvent(nodeId: string, overrides: Partial<IngestEvent> = {}): IngestEvent {
  const now = new Date().toISOString();
  return {
    id: `drone-${nodeId}-${Math.random()}`,
    source: "drone-rf",
    connectorId: "drone-rf",
    category: "drone",
    severity: "moderate",
    title: `Drone detection — node ${nodeId}`,
    occurredAt: now,
    receivedAt: now,
    geo: { lat: 38.9, lon: -77.0 },
    payload: { nodeId, rangeM: 120, rangeErrorM: 24, rssi: -60, doppler: [0.1, 0.3] },
    ...overrides,
  };
}

describe("DroneTrackAggregator", () => {
  let agg: DroneTrackAggregator;

  beforeEach(() => {
    agg = new DroneTrackAggregator();
  });

  it("creates a single DroneTrack for repeated detections from one node", () => {
    for (let i = 0; i < 10; i++) agg.process(makeEvent("node-1"));
    const tracks = agg.activeTracks();
    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.positionHistory).toHaveLength(10);
    expect(tracks[0]!.nodeId).toBe("node-1");
    expect(tracks[0]!.state).toBe("active");
  });

  it("creates separate tracks for different nodes", () => {
    agg.process(makeEvent("node-1"));
    agg.process(makeEvent("node-2"));
    expect(agg.activeTracks()).toHaveLength(2);
  });

  it("transitions track to coasting when > 5s since last detection", () => {
    vi.useFakeTimers();
    agg.process(makeEvent("node-1"));
    expect(agg.activeTracks()[0]!.state).toBe("active");
    vi.advanceTimersByTime(6000);
    agg.tick();
    expect(agg.activeTracks()[0]!.state).toBe("coasting");
    vi.useRealTimers();
  });

  it("transitions coasting track to expired after 60s of coasting", () => {
    vi.useFakeTimers();
    agg.process(makeEvent("node-1"));
    vi.advanceTimersByTime(6000);
    agg.tick(); // → coasting
    vi.advanceTimersByTime(61_000);
    agg.tick(); // → expired
    expect(agg.activeTracks()).toHaveLength(0);
    vi.useRealTimers();
  });

  it("marks two correlated tracks as swarmCorrelated", () => {
    // Two events per node in the same NE direction → Kalman builds matching velocity vectors
    agg.process(makeEvent("node-1", { geo: { lat: 38.90, lon: -77.00 } }));
    agg.process(makeEvent("node-1", { geo: { lat: 38.91, lon: -76.99 } }));
    agg.process(makeEvent("node-2", { geo: { lat: 38.80, lon: -77.10 } }));
    agg.process(makeEvent("node-2", { geo: { lat: 38.81, lon: -77.09 } }));
    agg.correlateSwarms();
    const tracks = agg.activeTracks();
    expect(tracks.find(t => t.nodeId === "node-1")?.swarmCorrelated).toBe(true);
    expect(tracks.find(t => t.nodeId === "node-2")?.swarmCorrelated).toBe(true);
  });

  it("does not mark divergent tracks as swarmCorrelated", () => {
    // node-1 goes NE, node-2 goes SW → headings ~45° and ~225° → angleDiff 180° >> 15° tolerance
    agg.process(makeEvent("node-1", { geo: { lat: 38.90, lon: -77.00 } }));
    agg.process(makeEvent("node-1", { geo: { lat: 38.91, lon: -76.99 } }));
    agg.process(makeEvent("node-2", { geo: { lat: 38.90, lon: -77.00 } }));
    agg.process(makeEvent("node-2", { geo: { lat: 38.89, lon: -77.01 } }));
    agg.correlateSwarms();
    const tracks = agg.activeTracks();
    expect(tracks.every(t => !t.swarmCorrelated)).toBe(true);
  });
});
