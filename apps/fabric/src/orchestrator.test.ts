import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Orchestrator } from "./orchestrator.js";
import { db, encrypt, upsertInstance } from "./db.js";

const DEMO_LOCATIONS = [{ lat: 38.9, lon: -77.0, label: "DC" }];

beforeEach(() => {
  db.prepare("DELETE FROM connector_instances").run();
  db.prepare("DELETE FROM events").run();
});

// ─── start() ──────────────────────────────────────────────────────────────────

describe("Orchestrator.start", () => {
  it("loads persisted disabled instances without starting them", async () => {
    upsertInstance({
      id: "inst-persisted",
      connectorId: "demo-simulator",
      label: "Persisted Sim",
      enabled: 0,
      config: encrypt(JSON.stringify({ intervalMs: 100, locations: DEMO_LOCATIONS })),
    });
    const orc = new Orchestrator();
    await orc.start();
    const statuses = orc.allStatus();
    expect(statuses).toHaveLength(1);
    expect(statuses[0]!.label).toBe("Persisted Sim");
    expect(statuses[0]!.enabled).toBe(false);
    expect(statuses[0]!.connected).toBe(false);
    orc.stop();
  });

  it("starts enabled instances and marks them connected", async () => {
    upsertInstance({
      id: "inst-enabled",
      connectorId: "demo-simulator",
      label: "Running Sim",
      enabled: 1,
      config: encrypt(JSON.stringify({ intervalMs: 500, locations: DEMO_LOCATIONS })),
    });
    const orc = new Orchestrator();
    await orc.start();
    const statuses = orc.allStatus();
    expect(statuses[0]!.connected).toBe(true);
    orc.stop();
  });

  it("skips unknown connectorId rows gracefully", async () => {
    upsertInstance({
      id: "inst-unknown",
      connectorId: "nonexistent-connector",
      label: "Bad",
      enabled: 1,
      config: encrypt("{}"),
    });
    const orc = new Orchestrator();
    await orc.start(); // should not throw
    expect(orc.allStatus()).toHaveLength(0);
    orc.stop();
  });
});

// ─── addInstance ──────────────────────────────────────────────────────────────

describe("Orchestrator.addInstance", () => {
  it("returns a string id, adds to allStatus(), and persists to DB", async () => {
    const orc = new Orchestrator();
    const id = orc.addInstance("demo-simulator", "My Sim", { intervalMs: 500, locations: DEMO_LOCATIONS }, false);
    expect(typeof id).toBe("string");
    const statuses = orc.allStatus();
    expect(statuses).toHaveLength(1);
    expect(statuses[0]!.label).toBe("My Sim");
    expect(statuses[0]!.enabled).toBe(false);
    // verify persisted to DB
    const rows = db.prepare("SELECT * FROM connector_instances WHERE id = ?").all(id) as any[];
    expect(rows).toHaveLength(1);
    orc.stop();
  });

  it("throws for an unknown connectorId", () => {
    const orc = new Orchestrator();
    expect(() => orc.addInstance("no-such-connector", "Bad", {}, false)).toThrow("unknown connector");
    orc.stop();
  });

  it("starts the connector when enabled=true and marks it connected", async () => {
    const orc = new Orchestrator();
    orc.addInstance("demo-simulator", "Live Sim", { intervalMs: 500, locations: DEMO_LOCATIONS }, true);
    const statuses = orc.allStatus();
    expect(statuses[0]!.connected).toBe(true);
    orc.stop();
  });
});

// ─── updateInstance ───────────────────────────────────────────────────────────

describe("Orchestrator.updateInstance", () => {
  it("throws for an unknown instance id", () => {
    const orc = new Orchestrator();
    expect(() => orc.updateInstance("no-such-id", { label: "X" })).toThrow("not found");
    orc.stop();
  });

  it("updates the label and reflects it in allStatus()", () => {
    const orc = new Orchestrator();
    const id = orc.addInstance("demo-simulator", "Old Label", { intervalMs: 500, locations: DEMO_LOCATIONS }, false);
    orc.updateInstance(id, { label: "New Label" });
    const found = orc.allStatus().find((s) => s.id === id);
    expect(found!.label).toBe("New Label");
    orc.stop();
  });

  it("disabling a running instance aborts it and sets enabled=false in allStatus()", async () => {
    const orc = new Orchestrator();
    const id = orc.addInstance("demo-simulator", "Sim", { intervalMs: 500, locations: DEMO_LOCATIONS }, true);
    expect(orc.allStatus().find((s) => s.id === id)!.enabled).toBe(true);
    orc.updateInstance(id, { enabled: false });
    const s = orc.allStatus().find((s) => s.id === id)!;
    expect(s.enabled).toBe(false);
    orc.stop();
  });

  it("enabling a disabled instance sets enabled=true and starts the connector", () => {
    const orc = new Orchestrator();
    const id = orc.addInstance("demo-simulator", "Sim", { intervalMs: 500, locations: DEMO_LOCATIONS }, false);
    orc.updateInstance(id, { enabled: true });
    const s = orc.allStatus().find((s) => s.id === id)!;
    expect(s.enabled).toBe(true);
    expect(s.connected).toBe(true);
    orc.stop();
  });
});

// ─── removeInstance ───────────────────────────────────────────────────────────

describe("Orchestrator.removeInstance", () => {
  it("removes the instance from allStatus()", () => {
    const orc = new Orchestrator();
    const id = orc.addInstance("demo-simulator", "Del Sim", { intervalMs: 500, locations: DEMO_LOCATIONS }, false);
    expect(orc.allStatus()).toHaveLength(1);
    orc.removeInstance(id);
    expect(orc.allStatus()).toHaveLength(0);
    orc.stop();
  });

  it("removes the instance from the DB", () => {
    const orc = new Orchestrator();
    const id = orc.addInstance("demo-simulator", "Del Sim", { intervalMs: 500, locations: DEMO_LOCATIONS }, false);
    orc.removeInstance(id);
    const rows = db.prepare("SELECT * FROM connector_instances WHERE id = ?").all(id) as any[];
    expect(rows).toHaveLength(0);
    orc.stop();
  });

  it("is a no-op for an unknown id (does not throw)", () => {
    const orc = new Orchestrator();
    expect(() => orc.removeInstance("no-such")).not.toThrow();
    orc.stop();
  });
});

// ─── allStatus / event counting ───────────────────────────────────────────────

describe("Orchestrator.allStatus — event counting", () => {
  it("increments eventsLastMinute and eventsLastHour as events are emitted", async () => {
    const orc = new Orchestrator();
    // Use a 50ms interval so events arrive quickly
    const id = orc.addInstance(
      "demo-simulator",
      "Fast Sim",
      { intervalMs: 50, locations: DEMO_LOCATIONS },
      true,
    );
    // Wait for a few events
    await new Promise((resolve) => setTimeout(resolve, 300));
    const s = orc.allStatus().find((s) => s.id === id)!;
    expect(s.eventsLastMinute).toBeGreaterThan(0);
    expect(s.eventsLastHour).toBeGreaterThan(0);
    orc.stop();
  });

  it("emits a 'status' event when allStatus changes", async () => {
    const orc = new Orchestrator();
    const emitted: any[] = [];
    orc.on("status", (s) => emitted.push(s));
    orc.addInstance("demo-simulator", "Sim", { intervalMs: 500, locations: DEMO_LOCATIONS }, false);
    expect(emitted.length).toBeGreaterThan(0);
    orc.stop();
  });
});

// ─── event forwarding ─────────────────────────────────────────────────────────

describe("Orchestrator — event forwarding", () => {
  it("emits an 'event' on the orchestrator when a connector emits an event", async () => {
    const orc = new Orchestrator();
    const received: any[] = [];
    orc.on("event", (ev) => received.push(ev));
    orc.addInstance(
      "demo-simulator",
      "Fast Sim",
      { intervalMs: 50, locations: DEMO_LOCATIONS },
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(received.length).toBeGreaterThan(0);
    expect(received[0]).toHaveProperty("id");
    expect(received[0]).toHaveProperty("category");
    expect(received[0]).toHaveProperty("receivedAt");
    orc.stop();
  });

  it("persists emitted events to the DB", async () => {
    const orc = new Orchestrator();
    orc.addInstance(
      "demo-simulator",
      "Persist Sim",
      { intervalMs: 50, locations: DEMO_LOCATIONS },
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    const rows = db.prepare("SELECT COUNT(*) as cnt FROM events").get() as { cnt: number };
    expect(rows.cnt).toBeGreaterThan(0);
    orc.stop();
  });
});
