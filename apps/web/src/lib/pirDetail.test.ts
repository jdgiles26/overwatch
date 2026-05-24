import { describe, it, expect } from "vitest";
import type { IngestEvent, PIR } from "@overwatch/schemas";
import { buildPirEvidence, pirShowOnMapTarget } from "./pirDetail";

function evt(over: Partial<IngestEvent>): IngestEvent {
  const now = new Date().toISOString();
  return {
    id: over.id ?? "ev-x",
    source: "test",
    connectorId: "test",
    category: "weather",
    severity: "low",
    title: "x",
    occurredAt: now,
    receivedAt: now,
    ...over,
  };
}

const basePir: PIR = {
  id: "weather-25km",
  question: "Severe weather within 25 miles?",
  answer: "yes",
  detail: "NWS aggregate",
  evidenceIds: ["e1", "e3"],
};

describe("buildPirEvidence", () => {
  it("returns only events matched by evidenceIds, preserving order", () => {
    const events = [evt({ id: "e1" }), evt({ id: "e2" }), evt({ id: "e3" })];
    const r = buildPirEvidence(basePir, events);
    expect(r.events.map((e) => e.id)).toEqual(["e1", "e3"]);
  });

  it("firstGeoEvent picks the first matched event with a geo", () => {
    const events = [
      evt({ id: "e1" }),
      evt({ id: "e3", geo: { lat: 38.9, lon: -77.0 } }),
    ];
    const r = buildPirEvidence(basePir, events);
    expect(r.firstGeoEvent?.id).toBe("e3");
  });

  it("firstGeoEvent is null when no matched event has geo", () => {
    const events = [evt({ id: "e1" }), evt({ id: "e3" })];
    expect(buildPirEvidence(basePir, events).firstGeoEvent).toBeNull();
  });

  it("handles missing evidenceIds gracefully", () => {
    const pir: PIR = { ...basePir, evidenceIds: [] };
    expect(buildPirEvidence(pir, [evt({ id: "e1" })]).events).toEqual([]);
  });
});

describe("pirShowOnMapTarget", () => {
  it("returns coords of the first geo-located evidence event", () => {
    const events = [evt({ id: "e1", geo: { lat: 10, lon: 20 } })];
    const pir: PIR = { ...basePir, evidenceIds: ["e1"] };
    expect(pirShowOnMapTarget(pir, events)).toEqual({ lat: 10, lon: 20, zoom: 7 });
  });

  it("returns null when no evidence has geo", () => {
    expect(pirShowOnMapTarget(basePir, [evt({ id: "e1" })])).toBeNull();
  });

  it("respects an explicit zoom argument", () => {
    const events = [evt({ id: "e1", geo: { lat: 0, lon: 0 } })];
    const pir: PIR = { ...basePir, evidenceIds: ["e1"] };
    expect(pirShowOnMapTarget(pir, events, 12)?.zoom).toBe(12);
  });
});
