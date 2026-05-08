import { describe, it, expect, beforeEach, vi } from "vitest";
import { RuleEngine } from "./alerts.js";
import { db, upsertRule, upsertLocation } from "./db.js";
import type { IngestEvent } from "@overwatch/schemas";

function makeEvent(overrides: Partial<IngestEvent> = {}): IngestEvent {
  const now = new Date().toISOString();
  return {
    id: `ev-${Math.random().toString(36).slice(2)}`,
    source: "test",
    connectorId: "test",
    category: "weather",
    severity: "high",
    title: "Severe Thunderstorm Warning",
    summary: "Large hail and damaging winds expected",
    occurredAt: now,
    receivedAt: now,
    geo: { lat: 38.9, lon: -77.0 },
    ...overrides,
  };
}

beforeEach(() => {
  db.prepare("DELETE FROM alert_rules").run();
  db.prepare("DELETE FROM alert_firings").run();
  db.prepare("DELETE FROM locations").run();
});

// ─── basic match ─────────────────────────────────────────────────────────────

describe("RuleEngine.evaluate — basic match", () => {
  it("fires when an enabled rule has no conditions beyond what the event satisfies", () => {
    upsertRule({
      id: "r1",
      label: "Any Weather",
      enabled: true,
      notify: { desktop: false, sound: false, soundKind: "none", severityFloor: "info" },
      condition: { categories: ["weather"], rateLimitMs: 0 },
    });
    const engine = new RuleEngine();
    const firings = engine.evaluate(makeEvent());
    expect(firings).toHaveLength(1);
    expect(firings[0]!.ruleId).toBe("r1");
    expect(firings[0]!.ruleLabel).toBe("Any Weather");
  });

  it("does not fire when there are no rules", () => {
    const engine = new RuleEngine();
    expect(engine.evaluate(makeEvent())).toHaveLength(0);
  });
});

// ─── disabled rule ────────────────────────────────────────────────────────────

describe("RuleEngine.evaluate — disabled rule", () => {
  it("skips disabled rules even when all conditions match", () => {
    upsertRule({
      id: "r-off",
      label: "Disabled Rule",
      enabled: false,
      notify: { desktop: false, sound: false, soundKind: "none", severityFloor: "info" },
      condition: { categories: ["weather"], rateLimitMs: 0 },
    });
    const engine = new RuleEngine();
    expect(engine.evaluate(makeEvent())).toHaveLength(0);
  });
});

// ─── category filter ──────────────────────────────────────────────────────────

describe("RuleEngine.evaluate — category filter", () => {
  beforeEach(() => {
    upsertRule({
      id: "r-cat",
      label: "Seismic Only",
      enabled: true,
      notify: { desktop: false, sound: false, soundKind: "none", severityFloor: "info" },
      condition: { categories: ["seismic"], rateLimitMs: 0 },
    });
  });

  it("fires when event category matches rule categories", () => {
    const engine = new RuleEngine();
    const firings = engine.evaluate(makeEvent({ category: "seismic" }));
    expect(firings).toHaveLength(1);
  });

  it("does not fire when event category does not match", () => {
    const engine = new RuleEngine();
    const firings = engine.evaluate(makeEvent({ category: "weather" }));
    expect(firings).toHaveLength(0);
  });
});

// ─── minSeverity filter ───────────────────────────────────────────────────────

describe("RuleEngine.evaluate — minSeverity filter", () => {
  beforeEach(() => {
    upsertRule({
      id: "r-sev",
      label: "High+ Only",
      enabled: true,
      notify: { desktop: false, sound: false, soundKind: "none", severityFloor: "info" },
      condition: { minSeverity: "high", rateLimitMs: 0 },
    });
  });

  it("fires when event severity meets the minimum", () => {
    const engine = new RuleEngine();
    expect(engine.evaluate(makeEvent({ severity: "high" }))).toHaveLength(1);
    expect(engine.evaluate(makeEvent({ severity: "extreme" }))).toHaveLength(1);
  });

  it("does not fire when event severity is below the minimum", () => {
    const engine = new RuleEngine();
    expect(engine.evaluate(makeEvent({ severity: "moderate" }))).toHaveLength(0);
    expect(engine.evaluate(makeEvent({ severity: "low" }))).toHaveLength(0);
    expect(engine.evaluate(makeEvent({ severity: "info" }))).toHaveLength(0);
  });
});

// ─── keyword filter ───────────────────────────────────────────────────────────

describe("RuleEngine.evaluate — keyword filter", () => {
  beforeEach(() => {
    upsertRule({
      id: "r-kw",
      label: "Tornado Watch",
      enabled: true,
      notify: { desktop: false, sound: false, soundKind: "none", severityFloor: "info" },
      condition: { keywords: ["tornado", "hurricane"], rateLimitMs: 0 },
    });
  });

  it("fires when a keyword appears in the event title (case-insensitive)", () => {
    const engine = new RuleEngine();
    const firings = engine.evaluate(makeEvent({ title: "TORNADO WARNING issued for county" }));
    expect(firings).toHaveLength(1);
  });

  it("fires when a keyword appears in the event summary", () => {
    const engine = new RuleEngine();
    const firings = engine.evaluate(
      makeEvent({ title: "Storm Warning", summary: "Hurricane force winds expected" }),
    );
    expect(firings).toHaveLength(1);
  });

  it("does not fire when no keyword matches title or summary", () => {
    const engine = new RuleEngine();
    const firings = engine.evaluate(
      makeEvent({ title: "Fog Advisory", summary: "Dense fog reducing visibility" }),
    );
    expect(firings).toHaveLength(0);
  });
});

// ─── bbox filter ──────────────────────────────────────────────────────────────

describe("RuleEngine.evaluate — bbox filter", () => {
  beforeEach(() => {
    upsertRule({
      id: "r-bbox",
      label: "DC Area",
      enabled: true,
      notify: { desktop: false, sound: false, soundKind: "none", severityFloor: "info" },
      condition: { bbox: [-78.0, 38.5, -76.5, 39.5], rateLimitMs: 0 },
    });
  });

  it("fires when event geo falls inside the bbox", () => {
    const engine = new RuleEngine();
    const firings = engine.evaluate(makeEvent({ geo: { lat: 38.9, lon: -77.0 } }));
    expect(firings).toHaveLength(1);
  });

  it("does not fire when event geo is outside the bbox", () => {
    const engine = new RuleEngine();
    // London — well outside DC bbox
    expect(engine.evaluate(makeEvent({ geo: { lat: 51.5, lon: -0.1 } }))).toHaveLength(0);
  });

  it("does not fire when event has no geo", () => {
    const engine = new RuleEngine();
    expect(engine.evaluate(makeEvent({ geo: undefined }))).toHaveLength(0);
  });
});

// ─── nearLocationId filter ────────────────────────────────────────────────────

describe("RuleEngine.evaluate — nearLocationId filter", () => {
  beforeEach(() => {
    upsertLocation({ id: "loc-hq", label: "HQ", lat: 38.9, lon: -77.0, radiusKm: 50, kind: "work" });
    upsertRule({
      id: "r-geo",
      label: "Near HQ",
      enabled: true,
      notify: { desktop: false, sound: false, soundKind: "none", severityFloor: "info" },
      condition: { nearLocationId: "loc-hq", nearKm: 50, rateLimitMs: 0 },
    });
  });

  it("fires when event geo is within nearKm of the location", () => {
    const engine = new RuleEngine();
    // Same point as HQ — 0 km away
    const firings = engine.evaluate(makeEvent({ geo: { lat: 38.9, lon: -77.0 } }));
    expect(firings).toHaveLength(1);
  });

  it("does not fire when event geo is beyond nearKm", () => {
    const engine = new RuleEngine();
    // New York — ~350 km from DC
    const firings = engine.evaluate(makeEvent({ geo: { lat: 40.71, lon: -74.01 } }));
    expect(firings).toHaveLength(0);
  });

  it("does not fire when event has no geo", () => {
    const engine = new RuleEngine();
    expect(engine.evaluate(makeEvent({ geo: undefined }))).toHaveLength(0);
  });

  it("does not fire when the referenced location does not exist in DB", () => {
    db.prepare("DELETE FROM locations").run();
    const engine = new RuleEngine();
    const firings = engine.evaluate(makeEvent({ geo: { lat: 38.9, lon: -77.0 } }));
    expect(firings).toHaveLength(0);
  });
});

// ─── rate limiting ────────────────────────────────────────────────────────────

describe("RuleEngine.evaluate — rate limiting", () => {
  it("fires once and suppresses the second evaluation within rateLimitMs", () => {
    upsertRule({
      id: "r-rate",
      label: "Rate Limited",
      enabled: true,
      notify: { desktop: false, sound: false, soundKind: "none", severityFloor: "info" },
      condition: { rateLimitMs: 60_000 },
    });
    const engine = new RuleEngine();
    const first = engine.evaluate(makeEvent());
    const second = engine.evaluate(makeEvent());
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it("fires again after rateLimitMs has elapsed", () => {
    vi.useFakeTimers();
    upsertRule({
      id: "r-rate-time",
      label: "Rate Limited Time",
      enabled: true,
      notify: { desktop: false, sound: false, soundKind: "none", severityFloor: "info" },
      condition: { rateLimitMs: 5_000 },
    });
    const engine = new RuleEngine();
    engine.evaluate(makeEvent());
    vi.advanceTimersByTime(5_001);
    const after = engine.evaluate(makeEvent());
    expect(after).toHaveLength(1);
    vi.useRealTimers();
  });

  it("treats rateLimitMs: 0 as no rate limit (fires every time)", () => {
    upsertRule({
      id: "r-no-limit",
      label: "No Limit",
      enabled: true,
      notify: { desktop: false, sound: false, soundKind: "none", severityFloor: "info" },
      condition: { rateLimitMs: 0 },
    });
    const engine = new RuleEngine();
    expect(engine.evaluate(makeEvent())).toHaveLength(1);
    expect(engine.evaluate(makeEvent())).toHaveLength(1);
    expect(engine.evaluate(makeEvent())).toHaveLength(1);
  });
});

// ─── multiple rules ───────────────────────────────────────────────────────────

describe("RuleEngine.evaluate — multiple rules", () => {
  it("fires both rules when one event matches two enabled rules", () => {
    upsertRule({
      id: "r-multi-1",
      label: "Rule A",
      enabled: true,
      notify: { desktop: false, sound: false, soundKind: "none", severityFloor: "info" },
      condition: { categories: ["weather"], rateLimitMs: 0 },
    });
    upsertRule({
      id: "r-multi-2",
      label: "Rule B",
      enabled: true,
      notify: { desktop: false, sound: false, soundKind: "none", severityFloor: "info" },
      condition: { minSeverity: "moderate", rateLimitMs: 0 },
    });
    const engine = new RuleEngine();
    const firings = engine.evaluate(makeEvent({ category: "weather", severity: "high" }));
    expect(firings).toHaveLength(2);
    expect(firings.map((f) => f.ruleId).sort()).toEqual(["r-multi-1", "r-multi-2"]);
  });
});

// ─── reload ───────────────────────────────────────────────────────────────────

describe("RuleEngine.reload", () => {
  it("picks up rules added to DB after construction when reload() is called", () => {
    const engine = new RuleEngine();
    expect(engine.list()).toHaveLength(0);

    upsertRule({
      id: "r-reload",
      label: "Added Later",
      enabled: true,
      notify: { desktop: false, sound: false, soundKind: "none", severityFloor: "info" },
      condition: { rateLimitMs: 0 },
    });
    engine.reload();

    expect(engine.list()).toHaveLength(1);
    expect(engine.evaluate(makeEvent())).toHaveLength(1);
  });

  it("emits a 'rules' event with updated list on reload()", () => {
    const engine = new RuleEngine();
    const emitted: any[] = [];
    engine.on("rules", (rules) => emitted.push(rules));

    upsertRule({
      id: "r-event",
      label: "Emitted",
      enabled: true,
      notify: { desktop: false, sound: false, soundKind: "none", severityFloor: "info" },
      condition: { rateLimitMs: 0 },
    });
    engine.reload();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toHaveLength(1);
    expect(emitted[0][0].id).toBe("r-event");
  });
});
