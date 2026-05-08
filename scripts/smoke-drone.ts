/**
 * End-to-end drone smoke test.
 *
 * Starts a tiny HTTP frame server on :8091, registers a drone-rf connector
 * (http mode) with fabric, then verifies each checkpoint in order:
 *
 *  1. Fabric health check
 *  2. Connector registered and starts polling
 *  3. drone-track WS message received
 *  4. Drone events persisted (GET /api/events, category=drone)
 *  5. THREATCON PIR contains drone-alert entry
 *  6. Extreme-severity event (via cv-event → DB) → THREATCON score boost ≥ 2.0
 *  7. Alert rule fires for moderate drone event (full connector pipeline)
 *
 * Notes:
 *  - drone-rf parseFrame maps RSSI to max "moderate" severity.
 *    Steps 6 uses /api/cv-event which persists directly to DB (THREATCON
 *    reads live from DB). Step 7 uses the connector pipeline so the rule
 *    engine fires correctly.
 *  - Node 22+ built-in WebSocket is used (no ws package dependency).
 */

import http from "node:http";

const FABRIC = "http://localhost:4311";
const FRAME_PORT = 8091;

// ── helpers ────────────────────────────────────────────────────────────────

function pass(msg: string) { console.log(`  ✅ ${msg}`); }
function fail(msg: string) { console.error(`  ❌ ${msg}`); process.exitCode = 1; }
function info(msg: string) { console.log(`  ℹ  ${msg}`); }

async function get(path: string): Promise<any> {
  const r = await fetch(`${FABRIC}${path}`);
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json();
}

async function post(path: string, body: unknown): Promise<any> {
  const r = await fetch(`${FABRIC}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}: ${text}`);
  return JSON.parse(text);
}

async function del(path: string) {
  await fetch(`${FABRIC}${path}`, { method: "DELETE" });
}

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

// ── frame server ───────────────────────────────────────────────────────────

const frameServer = http.createServer((_req, res) => {
  const frame = {
    ts: new Date().toISOString(),
    nodeId: "smoke-node-1",
    doppler: [0.1, 0.3, 0.7],
    rssi: -55,  // -55 > -80 threshold → "moderate" severity
    rangeM: 120,
  };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify([frame]));
});

// ── WS helper: wait for a matching message via built-in WebSocket ──────────

function waitForMessage(
  ws: WebSocket,
  predicate: (msg: unknown) => boolean,
  timeoutMs = 12_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tid = setTimeout(
      () => reject(new Error("timeout waiting for WS message")),
      timeoutMs,
    );
    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (predicate(msg)) {
          clearTimeout(tid);
          ws.removeEventListener("message", handler);
          resolve(msg);
        }
      } catch { /* skip non-JSON */ }
    };
    ws.addEventListener("message", handler);
  });
}

// ── main ───────────────────────────────────────────────────────────────────

let connectorInstanceId: string | null = null;
let ruleId: string | null = null;

async function cleanup() {
  frameServer.close();
  if (connectorInstanceId) await del(`/api/connectors/${connectorInstanceId}`).catch(() => {});
  if (ruleId) await del(`/api/rules/${ruleId}`).catch(() => {});
}

async function main() {
  console.log("\n=== Overwatch drone smoke test ===\n");

  // ── Step 1: Fabric health ────────────────────────────────────────────────
  console.log("Step 1: Fabric health check");
  try {
    const h: any = await get("/health");
    if (h.ok) pass("Fabric is up");
    else fail("Fabric health not ok");
  } catch (e: any) {
    fail(`Fabric not reachable: ${e.message}`);
    console.error("\n  → Start fabric first:  pnpm --filter @overwatch/fabric dev\n");
    return;
  }

  // Start frame server
  await new Promise<void>((res) => frameServer.listen(FRAME_PORT, res));
  info(`Frame server listening on :${FRAME_PORT}`);

  // ── Step 2: Register connector ───────────────────────────────────────────
  console.log("\nStep 2: Register drone-rf connector (http mode)");
  try {
    const result: any = await post("/api/connectors", {
      connectorId: "drone-rf",
      label: "Smoke Test RF Node",
      enabled: true,
      config: {
        mode: "http",
        endpointUrl: `http://localhost:${FRAME_PORT}/detections`,
        pollIntervalMs: 500,
        nodeId: "smoke-node-1",
        nodeLat: 38.9072,
        nodeLon: -77.0369,
        nodeAltM: 10,
        defaultRangeM: 150,
        severityThresholdRssi: -80,
      },
    });
    connectorInstanceId = result.id;
    pass(`Connector created (id=${result.id})`);
  } catch (e: any) {
    fail(`Failed to create connector: ${e.message}`);
    return;
  }

  // ── Step 3: WS drone-track ───────────────────────────────────────────────
  console.log("\nStep 3: Wait for drone-track envelope on WebSocket");
  const ws = new WebSocket("ws://localhost:4311/ws");
  await new Promise<void>((res, rej) => {
    ws.addEventListener("open", () => res(), { once: true });
    ws.addEventListener("error", (e: Event) => rej(new Error(String(e))), { once: true });
  });
  info("WS connected");

  try {
    const msg: any = await waitForMessage(ws, (m: any) => m?.type === "drone-track");
    pass(`drone-track received: id=${msg.data?.id}, state=${msg.data?.state}, geo=(${msg.data?.geo?.lat?.toFixed(4)}, ${msg.data?.geo?.lon?.toFixed(4)})`);
  } catch (e: any) {
    fail(`No drone-track within 12s: ${e.message}`);
  }

  await sleep(1500);

  // ── Step 4: Events persisted ─────────────────────────────────────────────
  console.log("\nStep 4: Check /api/events for drone category");
  try {
    const events: any[] = await get("/api/events?limit=100");
    const droneEvents = events.filter((e: any) => e.category === "drone");
    if (droneEvents.length > 0) {
      pass(`${droneEvents.length} drone event(s) in DB (latest: "${droneEvents[0]?.title}")`);
    } else {
      fail("No drone events found in /api/events");
    }
  } catch (e: any) {
    fail(`Error fetching events: ${e.message}`);
  }

  // ── Step 5: PIR drone-alert entry ────────────────────────────────────────
  console.log("\nStep 5: Check THREATCON PIR for drone-alert entry");
  try {
    const { pir }: any = await get("/api/threatcon");
    const droneEntry: any = (pir as any[])?.find((p) =>
      p.question?.toLowerCase().includes("drone"),
    );
    if (droneEntry) {
      pass(`PIR drone-alert: answer="${droneEntry.answer}" — "${droneEntry.question}"`);
    } else {
      fail("No drone-alert PIR entry found");
      info(`PIR questions: ${JSON.stringify(pir?.map((p: any) => p.question))}`);
    }
  } catch (e: any) {
    fail(`Error fetching threatcon: ${e.message}`);
  }

  // ── Step 6: Extreme severity → THREATCON boost ≥ 2.0 ────────────────────
  // /api/cv-event persists to DB; GET /api/threatcon recomputes live from DB.
  console.log("\nStep 6: Extreme drone event → THREATCON score boost ≥ 2.0");
  try {
    const { threatcon: before }: any = await get("/api/threatcon");
    const scoreBefore: number = before.score;

    await post("/api/cv-event", {
      title: "Drone threat EXTREME — smoke test",
      category: "drone",
      severity: "extreme",
      source: "smoke-test",
      occurredAt: new Date().toISOString(),
      geo: { lat: 38.9072, lon: -77.0369 },
    });

    const { threatcon: after }: any = await get("/api/threatcon");
    const delta = after.score - scoreBefore;
    if (delta >= 2.0) {
      pass(`THREATCON score delta=${delta.toFixed(2)} (≥ 2.0) ✓ [${scoreBefore.toFixed(2)} → ${after.score.toFixed(2)}]`);
    } else {
      fail(`THREATCON delta=${delta.toFixed(2)} — expected ≥ 2.0 [${scoreBefore.toFixed(2)} → ${after.score.toFixed(2)}]`);
    }
  } catch (e: any) {
    fail(`Error in THREATCON boost test: ${e.message}`);
  }

  // ── Step 7: Rule engine fires via connector pipeline ─────────────────────
  // drone-rf produces max "moderate". Create a rule with minSeverity=moderate
  // and wait for the WS "alert" message (or /api/firings as fallback).
  console.log("\nStep 7: Alert rule fires for moderate drone event (connector pipeline)");
  try {
    const rule: any = await post("/api/rules", {
      label: "Smoke — drone moderate alert",
      enabled: true,
      notify: { desktop: false, sound: false, soundKind: "chime", severityFloor: "low" },
      condition: {
        categories: ["drone"],
        minSeverity: "moderate",
        keywords: [],
        rateLimitMs: 0,
      },
    });
    ruleId = rule.id;
    info(`Rule created: ${ruleId}`);

    // Frame server is still running; within 500ms the connector polls → event
    // flows through orchestrator → ruleEngine.evaluate → WS "alert".
    let fired = false;
    try {
      const alert: any = await waitForMessage(
        ws,
        (m: any) => m?.type === "alert" && m?.data?.ruleId === ruleId,
        6_000,
      );
      pass(`Alert fired (WS real-time): id=${alert.data?.id}, rule="${alert.data?.ruleLabel}"`);
      fired = true;
    } catch {
      // Rate-limit may have blocked first match; check DB
      await sleep(1000);
      const firings: any[] = await get("/api/firings?limit=20");
      const hit = firings.find((f: any) => (f.ruleId ?? f.rule_id) === ruleId);
      if (hit) {
        pass(`Alert fired (DB): id=${hit.id}`);
        fired = true;
      }
    }
    if (!fired) fail("No firing found for smoke rule within 7s");
  } catch (e: any) {
    fail(`Error in alert rule test: ${e.message}`);
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────
  ws.close();
  await cleanup();
  info("Connector and rule removed, frame server stopped.");

  // ── Manual browser checklist ─────────────────────────────────────────────
  console.log(`
=== Manual browser checks (web: pnpm --filter @overwatch/web dev) ===

  [ ] Map3D — Cesium globe shows drone billboard (quad-rotor icon) and
      ellipse range ring near 38.91°N, 77.04°W

  [ ] DroneDetailPanel — DevTools → Zustand → set followDroneId to any active
      track id → left-side panel shows:
        · state/ID badge, classification label, metrics (speed/heading/alt)
        · Sub-score bars (evasion, loiter, descent, payload stability, swarm)
        · Aggression sparkline after ~5s of classifications
        · "Follow track" / "Release camera" toggle

  [ ] Coasting — disconnect frame server connector, wait 6 s
      → trail switches from solid to dashed polyline

  [ ] Expiry — wait 60 s after last frame
      → Zustand droneTracks entry removed, billboard + ring gone from globe

  [ ] Camera follow — "Follow track" → camera.flyTo 800 m above track,
      pitch -45°, heading = track.headingDeg

  [ ] THREATCON broadcast — WS "threatcon" message arrives on 15 s interval;
      DevTools → Network → WS → score should reflect extreme event from Step 6

  [ ] Rules UI — visit /rules, create drone/moderate rule via UI;
      re-run:  pnpm --filter overwatch seed
      then confirm new firing appears in the firings table
`);

  const exitCode = process.exitCode ?? 0;
  console.log(`=== Automated checks: ${exitCode === 0 ? "ALL PASSED ✅" : "SOME FAILED ❌"} ===\n`);
}

main().catch(async (e) => {
  console.error("Unexpected error:", e);
  await cleanup().catch(() => {});
  process.exit(1);
});
