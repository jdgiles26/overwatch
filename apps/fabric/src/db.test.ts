import { describe, it, expect, beforeEach } from "vitest";
import {
  encrypt,
  decrypt,
  persistEvent,
  recentEvents,
  eventsByBbox,
  upsertLocation,
  listLocations,
  deleteLocation,
  upsertCamera,
  listCameras,
  deleteCamera,
  upsertRule,
  listRules,
  deleteRule,
  recordFiring,
  listFirings,
  upsertAoi,
  listAois,
  deleteAoi,
  upsertInstance,
  listInstances,
  deleteInstance,
  db,
} from "./db.js";
import type { IngestEvent } from "@overwatch/schemas";

function makeEvent(id: string, overrides: Partial<IngestEvent> = {}): IngestEvent {
  const now = new Date().toISOString();
  return {
    id,
    source: "test-source",
    connectorId: "test-connector",
    category: "weather",
    severity: "moderate",
    title: `Test event ${id}`,
    occurredAt: now,
    receivedAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  db.prepare("DELETE FROM events").run();
  db.prepare("DELETE FROM locations").run();
  db.prepare("DELETE FROM cameras").run();
  db.prepare("DELETE FROM alert_rules").run();
  db.prepare("DELETE FROM alert_firings").run();
  db.prepare("DELETE FROM aois").run();
  db.prepare("DELETE FROM connector_instances").run();
});

// ─── encrypt / decrypt ────────────────────────────────────────────────────────

describe("encrypt / decrypt", () => {
  it("round-trips arbitrary plaintext", () => {
    const plain = '{"apiKey":"s3cr3t","host":"mqtt.example.com"}';
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it("produces a different ciphertext each call due to random IV", () => {
    const plain = "same-input";
    const c1 = encrypt(plain);
    const c2 = encrypt(plain);
    expect(c1).not.toBe(c2);
    // both still decrypt correctly
    expect(decrypt(c1)).toBe(plain);
    expect(decrypt(c2)).toBe(plain);
  });
});

// ─── persistEvent / recentEvents ─────────────────────────────────────────────

describe("persistEvent / recentEvents", () => {
  it("stores an event and retrieves all scalar fields", () => {
    const now = new Date().toISOString();
    const ev: IngestEvent = {
      id: "ev-1",
      source: "nws",
      connectorId: "nws-alerts",
      category: "weather",
      severity: "high",
      title: "Tornado Warning",
      summary: "Tornado spotted near downtown",
      occurredAt: now,
      receivedAt: now,
      geo: { lat: 35.5, lon: -97.5, alt: 400 },
      geoMentioned: "Oklahoma City",
      url: "https://example.com/alert/1",
      icon: "tornado",
      payload: { zone: "OKZ001" },
    };
    persistEvent(ev);
    const rows = recentEvents(10);
    const found = rows.find((e) => e.id === "ev-1");
    expect(found).toBeDefined();
    expect(found!.source).toBe("nws");
    expect(found!.connectorId).toBe("nws-alerts");
    expect(found!.category).toBe("weather");
    expect(found!.severity).toBe("high");
    expect(found!.title).toBe("Tornado Warning");
    expect(found!.summary).toBe("Tornado spotted near downtown");
    expect(found!.geo?.lat).toBe(35.5);
    expect(found!.geo?.lon).toBe(-97.5);
    expect(found!.geo?.alt).toBe(400);
    expect(found!.geoMentioned).toBe("Oklahoma City");
    expect(found!.url).toBe("https://example.com/alert/1");
    expect(found!.icon).toBe("tornado");
    expect(found!.payload?.zone).toBe("OKZ001");
  });

  it("upserts on duplicate id (replace semantics)", () => {
    persistEvent(makeEvent("ev-dup", { title: "Original" }));
    persistEvent(makeEvent("ev-dup", { title: "Updated" }));
    const rows = recentEvents(10).filter((e) => e.id === "ev-dup");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Updated");
  });

  it("respects the limit parameter", () => {
    for (let i = 0; i < 10; i++) persistEvent(makeEvent(`limit-${i}`));
    expect(recentEvents(3)).toHaveLength(3);
  });

  it("returns events ordered newest first (by received_at DESC)", () => {
    const t1 = new Date(Date.now() - 10_000).toISOString();
    const t2 = new Date(Date.now() - 5_000).toISOString();
    const t3 = new Date().toISOString();
    persistEvent(makeEvent("order-1", { receivedAt: t1 }));
    persistEvent(makeEvent("order-2", { receivedAt: t2 }));
    persistEvent(makeEvent("order-3", { receivedAt: t3 }));
    const rows = recentEvents(10);
    const ids = rows.map((e) => e.id);
    expect(ids.indexOf("order-3")).toBeLessThan(ids.indexOf("order-1"));
  });

  it("stores an event with no geo as undefined geo in result", () => {
    persistEvent(makeEvent("no-geo"));
    const found = recentEvents(10).find((e) => e.id === "no-geo");
    expect(found!.geo).toBeUndefined();
  });
});

// ─── eventsByBbox ─────────────────────────────────────────────────────────────

describe("eventsByBbox", () => {
  it("returns only events whose geo falls within the bbox", () => {
    persistEvent(makeEvent("inside", { geo: { lat: 38.9, lon: -77.0 } }));
    persistEvent(makeEvent("outside", { geo: { lat: 51.5, lon: -0.1 } }));
    persistEvent(makeEvent("no-geo"));
    const results = eventsByBbox(-78, 38, -76, 40, 100);
    const ids = results.map((e) => e.id);
    expect(ids).toContain("inside");
    expect(ids).not.toContain("outside");
    expect(ids).not.toContain("no-geo");
  });

  it("respects the limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      persistEvent(makeEvent(`bbox-${i}`, { geo: { lat: 38.9, lon: -77.0 } }));
    }
    expect(eventsByBbox(-78, 38, -76, 40, 2)).toHaveLength(2);
  });
});

// ─── locations ────────────────────────────────────────────────────────────────

describe("locations CRUD", () => {
  it("upserts a location and retrieves it", () => {
    upsertLocation({ id: "loc-1", label: "HQ", lat: 38.9, lon: -77.0, radiusKm: 50, kind: "work" });
    const rows = listLocations();
    const found = rows.find((l: any) => l.id === "loc-1");
    expect(found).toBeDefined();
    expect(found!.label).toBe("HQ");
    expect(found!.lat).toBe(38.9);
    expect(found!.lon).toBe(-77.0);
    expect(found!.radius_km).toBe(50);
    expect(found!.kind).toBe("work");
  });

  it("deletes a location", () => {
    upsertLocation({ id: "loc-del", label: "To Delete", lat: 0, lon: 0, radiusKm: 10, kind: "other" });
    deleteLocation("loc-del");
    expect(listLocations().find((l: any) => l.id === "loc-del")).toBeUndefined();
  });

  it("upsert defaults radius_km to 25 when omitted", () => {
    upsertLocation({ id: "loc-defaults", label: "Default", lat: 0, lon: 0 });
    const found = listLocations().find((l: any) => l.id === "loc-defaults") as any;
    expect(found!.radius_km).toBe(25);
  });
});

// ─── cameras ─────────────────────────────────────────────────────────────────

describe("cameras CRUD", () => {
  it("upserts a camera and retrieves it", () => {
    upsertCamera({
      id: "cam-1",
      label: "Front Gate",
      source: "rtsp://192.168.1.10/stream",
      kind: "rtsp",
      lat: 38.9,
      lon: -77.0,
      whepUrl: "http://go2rtc/api/webrtc?src=cam-1",
      detectors: ["motion", "person"],
    });
    const rows = listCameras();
    const found = rows.find((c: any) => c.id === "cam-1");
    expect(found).toBeDefined();
    expect(found!.label).toBe("Front Gate");
    expect(found!.kind).toBe("rtsp");
  });

  it("deletes a camera", () => {
    upsertCamera({ id: "cam-del", label: "Temp", source: "webcam://0", kind: "webcam" });
    deleteCamera("cam-del");
    expect(listCameras().find((c: any) => c.id === "cam-del")).toBeUndefined();
  });
});

// ─── alert rules ─────────────────────────────────────────────────────────────

describe("alert rules CRUD", () => {
  const rule = {
    id: "rule-1",
    label: "Tornado Watch",
    enabled: true,
    notify: { desktop: true, sound: true, soundKind: "siren", severityFloor: "high" },
    condition: { categories: ["weather"], minSeverity: "high", keywords: ["tornado"], rateLimitMs: 60_000 },
  };

  it("upserts a rule and retrieves it with correct structure", () => {
    upsertRule(rule);
    const rows = listRules();
    const found = rows.find((r: any) => r.id === "rule-1");
    expect(found).toBeDefined();
    expect(found!.label).toBe("Tornado Watch");
    expect(found!.enabled).toBe(true);
    expect(found!.notify.soundKind).toBe("siren");
    expect(found!.condition.categories).toContain("weather");
  });

  it("persists disabled state correctly", () => {
    upsertRule({ ...rule, id: "rule-disabled", enabled: false });
    const found = listRules().find((r: any) => r.id === "rule-disabled");
    expect(found!.enabled).toBe(false);
  });

  it("deletes a rule", () => {
    upsertRule({ ...rule, id: "rule-del" });
    deleteRule("rule-del");
    expect(listRules().find((r: any) => r.id === "rule-del")).toBeUndefined();
  });
});

// ─── alert firings ────────────────────────────────────────────────────────────

describe("alert firings", () => {
  it("records a firing and retrieves it", () => {
    const ev = makeEvent("fire-ev");
    const firing = {
      id: "firing-1",
      ruleId: "rule-1",
      ruleLabel: "Test Rule",
      event: ev,
      firedAt: new Date().toISOString(),
      reason: "severity high",
    };
    recordFiring(firing);
    const rows = listFirings(10);
    const found = rows.find((f: any) => f.id === "firing-1");
    expect(found).toBeDefined();
    expect(found!.ruleId).toBe("rule-1");
    expect(found!.ruleLabel).toBe("Test Rule");
    expect(found!.reason).toBe("severity high");
    expect(found!.event?.id).toBe("fire-ev");
  });

  it("respects the limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      recordFiring({ id: `fir-${i}`, ruleId: "r", ruleLabel: "R", event: makeEvent(`e-${i}`), firedAt: new Date().toISOString(), reason: "test" });
    }
    expect(listFirings(2)).toHaveLength(2);
  });
});

// ─── AOIs ─────────────────────────────────────────────────────────────────────

describe("AOIs CRUD", () => {
  it("upserts an AOI and retrieves polygon", () => {
    const polygon = [[38.9, -77.1], [38.9, -76.9], [38.7, -76.9], [38.7, -77.1]];
    upsertAoi({ id: "aoi-1", label: "DC Area", polygon });
    const rows = listAois();
    const found = rows.find((a: any) => a.id === "aoi-1");
    expect(found).toBeDefined();
    expect(found!.label).toBe("DC Area");
    expect(found!.polygon).toEqual(polygon);
  });

  it("deletes an AOI", () => {
    upsertAoi({ id: "aoi-del", label: "Del", polygon: [] });
    deleteAoi("aoi-del");
    expect(listAois().find((a: any) => a.id === "aoi-del")).toBeUndefined();
  });
});

// ─── connector instances ──────────────────────────────────────────────────────

describe("connector instances CRUD", () => {
  it("upserts an instance and retrieves it with encrypted config", () => {
    const cfg = encrypt('{"interval":5000}');
    upsertInstance({ id: "inst-1", connectorId: "simulator", label: "Demo Feed", enabled: 1, config: cfg });
    const rows = listInstances();
    const found = rows.find((i) => i.id === "inst-1");
    expect(found).toBeDefined();
    expect(found!.connectorId).toBe("simulator");
    expect(found!.label).toBe("Demo Feed");
    expect(found!.enabled).toBe(1);
    expect(decrypt(found!.config)).toBe('{"interval":5000}');
  });

  it("deletes an instance", () => {
    upsertInstance({ id: "inst-del", connectorId: "simulator", label: "Del", enabled: 1, config: encrypt("{}") });
    deleteInstance("inst-del");
    expect(listInstances().find((i) => i.id === "inst-del")).toBeUndefined();
  });
});
