import { describe, it, expect } from "vitest";
import { computeThreatcon, computePIR } from "./threatcon.js";
import type { IngestEvent } from "@overwatch/schemas";

function makeDroneEvent(severity: IngestEvent["severity"], minsAgo = 0): IngestEvent {
  const t = new Date(Date.now() - minsAgo * 60 * 1000).toISOString();
  return {
    id: `drone-test-${Math.random()}`,
    source: "drone-rf",
    connectorId: "drone-rf",
    category: "drone",
    severity,
    title: `Drone detection (${severity})`,
    occurredAt: t,
    receivedAt: t,
    geo: { lat: 38.9, lon: -77.0 },
    payload: {},
  };
}

describe("computeThreatcon — drone weighting", () => {
  it("adds 2.0 to score for an extreme drone event", () => {
    const baseline = computeThreatcon([], []);
    const withDrone = computeThreatcon([makeDroneEvent("extreme")], []);
    expect(withDrone.score - baseline.score).toBeCloseTo(2.0);
  });

  it("adds 1.0 to score for a high drone event", () => {
    const baseline = computeThreatcon([], []);
    const withDrone = computeThreatcon([makeDroneEvent("high")], []);
    expect(withDrone.score - baseline.score).toBeCloseTo(1.0);
  });
});

describe("computePIR — drone-alert entry", () => {
  it('answers "yes" when a high-severity drone event occurred in the last 15 min', () => {
    const pir = computePIR([makeDroneEvent("high", 5)], []);
    const entry = pir.find((p) => p.id === "drone-alert");
    expect(entry?.answer).toBe("yes");
  });

  it('answers "unknown" when a drone event is between 15–60 min old', () => {
    const pir = computePIR([makeDroneEvent("high", 30)], []);
    const entry = pir.find((p) => p.id === "drone-alert");
    expect(entry?.answer).toBe("unknown");
  });

  it('answers "no" when there are no drone events', () => {
    const pir = computePIR([], []);
    const entry = pir.find((p) => p.id === "drone-alert");
    expect(entry?.answer).toBe("no");
  });
});
