# Drone Airspace Detection Plan

**Goal:** Add passive RF-based drone detection to Overwatch — from ingest connector through server-side track aggregation to a live Cesium globe overlay with MobileViT XXS aggression inference.

**Architecture:** A new `drone-rf` connector ingests MQTT/HTTP frames from bistatic RF sensing nodes and emits `IngestEvent { category: "drone" }`. A new `DroneTrackAggregator` in fabric sequences those events into Kalman-smoothed `DroneTrack` entities, handles coasting (Ghost Track) during signal loss, and broadcasts `drone-track` WebSocket envelopes. The browser receives those envelopes, runs MobileViT XXS classification in a Web Worker, and renders live tracks, Range Rings, prediction arcs, and a DroneDetailPanel on the Cesium globe. The existing THREATCON/PIR/alert-rules pipeline consumes drone events unchanged.

**Spec:** `docs/specs/2026-05-05-drone-airspace-detection.md`

**Execution order:** Tasks must be completed in sequence — each task's types/exports are consumed by the next.

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `packages/schemas/src/index.ts` | **modify** | Add `"drone"` to `EventCategory`; add `DroneTrack`, `DroneClassification` schemas; extend `ServerToClient` |
| `packages/connectors/src/sources/mqtt-generic.ts` | **modify** | Add `"drone"` to hardcoded category enum |
| `packages/connectors/src/sources/webhook.ts` | **modify** | Add `"drone"` to hardcoded category enum |
| `packages/connectors/src/sources/rss.ts` | **modify** | Add `"drone"` to hardcoded category enum |
| `packages/connectors/src/sources/rest-generic.ts` | **modify** | Add `"drone"` to hardcoded category enum |
| `packages/connectors/src/sources/drone-rf.ts` | **create** | Drone RF connector — MQTT subscribe + HTTP poll modes |
| `packages/connectors/src/index.ts` | **modify** | Register `droneRf` connector |
| `apps/fabric/src/drone.ts` | **create** | `DroneTrackAggregator` — Kalman filter, coasting state machine, swarm correlation, WS broadcast |
| `apps/fabric/src/index.ts` | **modify** | Wire aggregator to orchestrator event stream; add `drone-track` / `drone-classification` WS broadcast |
| `apps/fabric/src/threatcon.ts` | **modify** | Drone THREATCON weights (+2.0 extreme / +1.0 high per active track); new drone PIR |
| `apps/web/src/lib/store.ts` | **modify** | Add `droneTracks`, `droneClassifications`, `followDroneId` and their mutators |
| `apps/web/src/lib/ws.ts` | **modify** | Handle `drone-track` and `drone-classification` envelopes; auto-follow on first extreme track |
| `apps/web/src/components/droneWorker.ts` | **create** | Web Worker — MobileViT XXS feature extraction, aggression classification, 30-step path prediction |
| `apps/web/src/components/DroneTrackLayer.tsx` | **create** | Cesium primitives — billboard, trail, Ghost Track, Range Ring, prediction arc, confidence cone |
| `apps/web/src/components/DroneDetailPanel.tsx` | **create** | Slide-in detail panel — all inference sub-scores, sparkline, follow toggle |
| `apps/web/src/components/Map3D.tsx` | **modify** | Co-orbiting camera follow for `followDroneId`; drift on coasting; release on expiry |

---

## Task 0 — Schema foundation

**Files:** `packages/schemas/src/index.ts`, `packages/connectors/src/sources/mqtt-generic.ts`, `packages/connectors/src/sources/webhook.ts`, `packages/connectors/src/sources/rss.ts`, `packages/connectors/src/sources/rest-generic.ts`

> No tests for schema-only changes (pure type additions). Run typecheck to verify.

- [ ] In `packages/schemas/src/index.ts`, add `"drone"` to the `EventCategory` z.enum values — insert between `"cv"` and `"space"` for alphabetical grouping
- [ ] Add `DroneTrack` Zod schema:
  ```ts
  export const DroneTrackState = z.enum(["active", "coasting", "expired"]);
  export const DroneTrack = z.object({
    id: z.string(),                          // e.g. "DT-1"
    nodeId: z.string(),
    geo: GeoPoint,                           // sensing node position for v1
    rangeM: z.number(),                      // estimated range from node
    rangeErrorM: z.number().default(0),      // ±error radius
    positionHistory: z.array(z.object({
      geo: GeoPoint,
      ts: z.string().datetime(),
    })).default([]),
    velocityMs: z.number().default(0),       // m/s
    headingDeg: z.number().default(0),       // 0–360
    altM: z.number().optional(),
    state: DroneTrackState.default("active"),
    coastingSince: z.string().datetime().optional(),
    lastDetectionAt: z.string().datetime(),
    swarmCorrelated: z.boolean().default(false),
  });
  export type DroneTrack = z.infer<typeof DroneTrack>;
  ```
- [ ] Add `DroneClassification` Zod schema:
  ```ts
  export const AggressionLabel = z.enum(["hostile", "neutral", "unknown"]);
  export const DroneClassification = z.object({
    trackId: z.string(),
    label: AggressionLabel.default("unknown"),
    aggressionScore: z.number().min(0).max(1).default(0),
    confidence: z.number().min(0).max(1).default(0),
    evasionScore: z.number().min(0).max(1).default(0),
    loiterRatio: z.number().min(0).max(1).default(0),
    descentRate: z.number().default(0),      // m/s toward nearest Location (positive = descending toward)
    payloadStability: z.number().min(0).max(1).default(0),
    swarmCorrelated: z.boolean().default(false),
    predictedPath: z.array(GeoPoint).default([]),  // 30 steps × ~1s
    estimatedTarget: z.string().optional(),        // label of nearest Location on path
    computedAt: z.string().datetime(),
  });
  export type DroneClassification = z.infer<typeof DroneClassification>;
  ```
- [ ] Extend `ServerToClient` discriminated union with two new members:
  ```ts
  z.object({ type: z.literal("drone-track"), data: DroneTrack }),
  z.object({ type: z.literal("drone-classification"), data: DroneClassification }),
  ```
- [ ] In `mqtt-generic.ts`, `webhook.ts`, `rss.ts`, and `rest-generic.ts`: add `"drone"` to each hardcoded `z.enum([...])` category list
- [ ] Run `pnpm typecheck` — confirm zero errors

---

## Task 1 — `drone-rf` connector

**Files:** create `packages/connectors/src/sources/drone-rf.ts`, modify `packages/connectors/src/index.ts`

> TDD: write the config parsing + frame validation test first.

- [ ] Write a unit test in `packages/connectors/src/sources/drone-rf.test.ts`:
  - Assert a valid MQTT frame `{ ts, nodeId, doppler: [1,2,3], rssi: -65, rangeM: 120 }` passes validation and maps to an `IngestEvent` with `category: "drone"` and correct `severity`
  - Assert a frame missing `nodeId` is rejected (returns `null`, does not emit)
  - Assert `rangeErrorM` defaults to 20% of `rangeM` when absent
- [ ] Run test — confirm it fails (connector does not exist)
- [ ] Create `packages/connectors/src/sources/drone-rf.ts`:
  ```ts
  // Config schema
  const Cfg = z.object({
    mode: z.enum(["mqtt", "http"]).default("mqtt"),
    // MQTT fields
    brokerUrl: z.string().default("ws://localhost:9001"),
    topic: z.string().default("overwatch/drone/#"),
    mqttUsername: z.string().default(""),
    mqttPassword: z.string().default(""),
    // HTTP poll fields
    endpointUrl: z.string().default("http://localhost:8080/detections"),
    pollIntervalMs: z.number().default(1000),
    // Node config
    nodeId: z.string().default("node-1"),
    nodeLat: z.number().default(0),
    nodeLon: z.number().default(0),
    nodeAltM: z.number().default(0),
    defaultRangeM: z.number().default(150),
    severityThresholdRssi: z.number().default(-80), // below this = low, above = moderate
  });
  ```
- [ ] Implement frame parser — validates `{ ts, nodeId, doppler, rssi, rangeM?, csi? }`, derives severity from RSSI, emits `IngestEvent { category: "drone", geo: node geo, payload: frame }`
- [ ] Implement MQTT mode (re-use `mqtt` package already in connectors deps; mirror `mqtt-generic.ts` connect/subscribe/cleanup pattern)
- [ ] Implement HTTP poll mode (mirror `rest-generic.ts` poll pattern using `fetchJson` util)
- [ ] In `packages/connectors/src/index.ts`: import and register `droneRf`, add to `ALL_CONNECTORS`
- [ ] Run test — confirm it passes
- [ ] Run `pnpm typecheck` — confirm zero errors

---

## Task 2 — `DroneTrackAggregator` (fabric)

**Files:** create `apps/fabric/src/drone.ts`

> TDD on the state machine and swarm logic — these are pure functions and the most complex logic in the feature.

- [ ] Write tests inline in a `drone.test.ts` alongside the module (or within the module behind a `if (process.env.NODE_ENV === "test")` guard — match existing fabric test conventions, which have none; create `apps/fabric/src/drone.test.ts`):
  - Feed 10 frames for track `node-1` → assert single `DroneTrack` with 10-entry `positionHistory`
  - Feed frames then a 6 s gap → assert `state` transitions to `"coasting"`
  - Feed frames then a 61 s gap → assert `state` transitions to `"expired"`
  - Feed two tracks with matching heading (±10°) and speed (±2 m/s) within 10 s → assert both have `swarmCorrelated: true`
  - Feed two tracks with divergent headings → assert `swarmCorrelated: false`
- [ ] Run tests — confirm they fail
- [ ] Implement Kalman state (constant-velocity, 2D lat/lon):
  - State vector: `[lat, lon, vLat, vLon]`
  - Predict step on each frame; update step when new detection arrives
  - Store last Kalman state per track ID
- [ ] Implement coasting state machine:
  - On new frame: set `state = "active"`, clear `coastingSince`
  - On 5 s elapsed since `lastDetectionAt`: set `state = "coasting"`, set `coastingSince`
  - On 60 s elapsed since `coastingSince`: set `state = "expired"`, emit expiry broadcast, remove from active map
  - Run coasting tick in a `setInterval(fn, 1000)` per aggregator instance
- [ ] Implement swarm correlation: on each update, scan all `active` tracks; if two tracks share heading ±10° and speed ±20% within a 10 s window, set `swarmCorrelated: true` on both and re-emit
- [ ] Implement `DroneTrackAggregator` class as an `EventEmitter` emitting `"track"` events with `DroneTrack` payload
- [ ] Export `aggregator` singleton (matches how `orchestrator` and `ruleEngine` are singletons in `index.ts`)
- [ ] Run tests — confirm they pass
- [ ] Run `pnpm typecheck`

---

## Task 3 — Wire aggregator into fabric `index.ts`

**Files:** modify `apps/fabric/src/index.ts`

> No new tests — integration wiring; verified by running the server.

- [ ] Import `aggregator` from `./drone.js`
- [ ] In the `orchestrator.on("event", ...)` handler: if `ev.category === "drone"`, call `aggregator.process(ev)` (define `process(ev: IngestEvent): void` on the aggregator class that runs the Kalman + state machine)
- [ ] In aggregator's `"track"` event handler: call `broadcast({ type: "drone-track", data: track })`
- [ ] On WebSocket connect (`app.get("/ws", ...)`), send current active tracks as initial state: `socket.send(JSON.stringify({ type: "snapshot-drones", data: aggregator.activeTracks() }))`
  - Add `snapshot-drones` to `ServerToClient` union (or handle as a plain `drone-track` burst — prefer the burst: loop `activeTracks()` and send one `drone-track` envelope per track)
- [ ] Start the coasting interval: `aggregator.start()` alongside `orchestrator.start()`; stop on SIGINT: `aggregator.stop()`
- [ ] Manually smoke-test: start fabric, `mosquitto_pub` a synthetic frame, confirm the WebSocket broadcasts a `drone-track` envelope (or use the existing simulator connector as a proxy)
- [ ] Run `pnpm typecheck`

---

## Task 4 — THREATCON / PIR drone weighting

**Files:** modify `apps/fabric/src/threatcon.ts`

> TDD on the new scoring path.

- [ ] Write tests in `apps/fabric/src/threatcon.test.ts`:
  - `computeThreatcon` with one `extreme` drone event and no locations → assert score increases by 2.0
  - `computeThreatcon` with one `high` drone event → assert score increases by 1.0
  - `computePIR` with a `drone` event `severity: "high"` in the last 15 min → assert PIR `drone-alert` answer is `"yes"`
  - `computePIR` with a `drone` event older than 15 min but within 60 min → assert answer is `"unknown"`
  - `computePIR` with no drone events → assert answer is `"no"`
- [ ] Run tests — confirm they fail
- [ ] In `computeThreatcon`: after the existing global severity boost loop, add a drone-specific pass:
  ```ts
  for (const e of recent) {
    if (e.category !== "drone") continue;
    if (e.severity === "extreme") { score += 2.0; reasons.push(`Extreme drone threat: ${e.title}`); }
    else if (e.severity === "high") { score += 1.0; reasons.push(`High drone threat: ${e.title}`); }
  }
  ```
- [ ] In `computePIR`: add new PIR entry:
  ```ts
  const cutoff15 = Date.now() - 15 * 60 * 1000;
  const cutoff60 = Date.now() - 60 * 60 * 1000;
  const droneHigh15 = events.filter(e => e.category === "drone" && sev(e.severity) >= 3 && new Date(e.receivedAt).getTime() > cutoff15);
  const droneAny60 = events.filter(e => e.category === "drone" && new Date(e.receivedAt).getTime() > cutoff60);
  mk("drone-alert", "Is hostile drone activity detected in the AO?",
    droneHigh15.length > 0 ? "yes" : droneAny60.length > 0 ? "unknown" : "no",
    droneHigh15[0] ? `Last: ${droneHigh15[0].title}` : undefined,
  )
  ```
- [ ] Run tests — confirm they pass
- [ ] Run `pnpm typecheck`

---

## Task 5 — Store additions

**Files:** modify `apps/web/src/lib/store.ts`

> No separate tests — verified by typecheck and downstream component usage.

- [ ] Add to `Store` type:
  ```ts
  droneTracks: DroneTrack[];
  droneClassifications: Record<string, DroneClassification>;  // keyed by trackId
  followDroneId: string | null;
  ```
- [ ] Add mutators to `Store` type:
  ```ts
  pushDroneTrack: (t: DroneTrack) => void;
  setDroneClassification: (id: string, c: DroneClassification) => void;
  setFollowDrone: (id: string | null) => void;
  ```
- [ ] Implement in the `create` call:
  - `droneTracks: []`, `droneClassifications: {}`, `followDroneId: null`
  - `pushDroneTrack(t)`: upsert by `t.id`, remove expired tracks, cap at 100 entries; remove expired track from `followDroneId` if it matches
  - `setDroneClassification(id, c)`: update `droneClassifications[id]`
  - `setFollowDrone(id)`: set `followDroneId`
- [ ] Import `DroneTrack`, `DroneClassification` from `@overwatch/schemas`
- [ ] Run `pnpm typecheck`

---

## Task 6 — WebSocket handler additions

**Files:** modify `apps/web/src/lib/ws.ts`

- [ ] Add `pushDroneTrack` and `setDroneClassification` and `setFollowDrone` to the store selectors at the top of `useFabricSocket`
- [ ] In `ws.onmessage`, add:
  ```ts
  else if (msg.type === "drone-track") {
    pushDroneTrack(msg.data);
    // auto-follow first extreme track if none currently followed
    if (!useStore.getState().followDroneId && msg.data.severity === "extreme") {
      setFollowDrone(msg.data.id);
    }
  }
  else if (msg.type === "drone-classification") {
    setDroneClassification(msg.data.trackId, msg.data);
  }
  ```
  Note: `DroneTrack` doesn't have a `severity` field — derive from the most recent `IngestEvent` in `positionHistory` payload, or promote severity onto `DroneTrack` schema (add `severity: Severity.default("moderate")` to `DroneTrack` in Task 0 and set it in the aggregator from the source event's severity). Resolve this before implementing.
- [ ] Add `setFollowDrone` to the `useEffect` dependency array
- [ ] Run `pnpm typecheck`

---

## Task 7 — `droneWorker.ts`

**Files:** create `apps/web/src/components/droneWorker.ts`

> The MobileViT XXS ONNX artifact is out-of-repo (training is out of scope). This task stubs the inference with a deterministic synthetic classifier so the full pipeline works end-to-end. A `TODO` marker flags where the real model slots in.

- [ ] Create `apps/web/src/components/droneWorker.ts` with `/// <reference lib="webworker" />` header
- [ ] Implement feature extraction from a `DroneTrack`:
  - **evasionScore**: heading variance over the last 10 positions (std dev of heading deltas, normalised 0–1)
  - **loiterRatio**: `1 - (net displacement / total path length)` over last 20 positions
  - **descentRate**: altitude change rate toward nearest Location (positive = approaching, from `positionHistory` + Location list passed in message)
  - **payloadStability**: inverse of altitude jitter variance (hover stability heuristic)
  - **swarmCorrelated**: pass through from `DroneTrack.swarmCorrelated`
- [ ] Implement path prediction (30 steps, ~1 s each): dead-reckoning from last known position + velocity + heading — straight line for now; replace with model output when ONNX artifact is available
- [ ] Implement aggression scoring (placeholder until ONNX model):
  ```ts
  // TODO: replace with MobileViT XXS ONNX inference once model artifact is at /models/drone-aggression.onnx
  // Feature vector: [evasionScore, loiterRatio, descentRate, payloadStability, swarmCorrelated ? 1 : 0]
  const aggressionScore = Math.min(1,
    evasionScore * 0.3 +
    loiterRatio * 0.2 +
    Math.max(0, descentRate) * 0.3 +
    (swarmCorrelated ? 0.2 : 0)
  );
  const label = aggressionScore > 0.65 ? "hostile" : aggressionScore > 0.35 ? "neutral" : "unknown";
  ```
- [ ] Implement nearest-target estimation: project path 30 steps, find which saved Location (passed in message) the path passes closest to; set `estimatedTarget` to that Location's label
- [ ] `self.onmessage` handler: receives `{ type: "classify", track: DroneTrack, locations: Location[] }`; computes above; posts back `{ type: "classification", data: DroneClassification }`
- [ ] Debounce: only re-classify when `positionHistory.length` has grown by ≥ 3 since last classification (avoid re-running on every frame at 20 Hz)
- [ ] Run `pnpm typecheck`

---

## Task 8 — `DroneTrackLayer.tsx`

**Files:** create `apps/web/src/components/DroneTrackLayer.tsx`

> Visual component — typecheck + manual visual verification against a seeded test track in the browser.

- [ ] Create component that receives no props — reads `droneTracks` and `droneClassifications` from store
- [ ] On mount / when Cesium viewer is available (prop or context — match `Map3D.tsx`'s pattern of receiving a `viewer` ref or read from a shared context): create a `PrimitiveCollection` for drone primitives
- [ ] For each `DroneTrack`:
  - **Billboard** — UAV SVG icon (inline data URI or public asset); colour: `red` if `label === "hostile"`, `orange` if `"neutral"`, `cyan` if `"unknown"`; positioned at `track.geo`
  - **Historical trail polyline** — solid if `state === "active"`, dashed (`dashLength` material) if `state === "coasting"`; colour matches billboard
  - **Range Ring** — `EllipseGeometry` centred at node geo with `semiMajorAxis = rangeM + rangeErrorM`, `semiMinorAxis = Math.max(1, rangeM - rangeErrorM)`; white at 20% opacity, 1px outline
  - **Prediction arc** — `PolylineGeometry` through the 30 `predictedPath` points from `DroneClassification`; colour matches billboard at 50% opacity; only render if classification exists
  - **Confidence cone** — `PolylineGeometry` fan (3–5 lines diverging from current position across the prediction horizon); width proportional to `1 - confidence`
- [ ] Remove primitive collection on component unmount / when track expires (`state === "expired"`)
- [ ] `useEffect` deps: `[droneTracks, droneClassifications]`
- [ ] Run `pnpm typecheck`

---

## Task 9 — `DroneDetailPanel.tsx`

**Files:** create `apps/web/src/components/DroneDetailPanel.tsx`

> UI component — typecheck + manual visual verification.

- [ ] Create panel that renders when `followDroneId` is non-null — reads matching `DroneTrack` and `DroneClassification` from store
- [ ] Layout (match `EventDetail.tsx` slide-in style):
  - Header: track ID (`DT-N`), state badge (`ACTIVE` / `COASTING` / `EXPIRED`), close button (`setFollowDrone(null)`)
  - Classification ring or badge: `HOSTILE` / `NEUTRAL` / `UNKNOWN` with aggression score `%`
  - Metrics row: speed (`velocityMs` m/s → km/h), heading (`headingDeg`°), altitude (`altM` m)
  - Predicted target chip: `estimatedTarget` Location label or `—`
  - Sub-score breakdown: five labelled progress bars (evasion, loiter, descent, payload, swarm)
  - Aggression sparkline: last 60 s of `aggressionScore` values (store the last 60 entries in the classification record or derive from `droneClassifications` history — simplest: keep a `Map<trackId, number[]>` in component state, append on each classification update)
  - "Follow track" / "Release" toggle button → `setFollowDrone(id)` / `setFollowDrone(null)`
  - Raw payload accordion (last detection frame from `DroneTrack` positionHistory tail)
- [ ] Mount point: add `<DroneDetailPanel />` to `apps/web/src/app/page.tsx` alongside `<EventDetail />`
- [ ] Run `pnpm typecheck`

---

## Task 10 — Map3D co-orbiting camera follow

**Files:** modify `apps/web/src/components/Map3D.tsx`

- [ ] Add `followDroneId` to the store subscriptions at the top of `Map3D`
- [ ] Add a new `useEffect([followDroneId, droneTracks])`:
  ```ts
  if (!followDroneId || !viewerRef.current) return;
  const track = droneTracks.find(t => t.id === followDroneId);
  if (!track || track.state === "expired") { setFollowDrone(null); return; }
  const geo = track.positionHistory.at(-1)?.geo ?? track.geo;
  viewerRef.current.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      geo.lon, geo.lat,
      (geo.alt ?? 0) + 800,   // 800 m above the track
    ),
    orientation: {
      heading: Cesium.Math.toRadians(track.headingDeg),
      pitch: Cesium.Math.toRadians(-45),   // 45° look-down angle
      roll: 0,
    },
    duration: track.state === "coasting" ? 3 : 0.5,  // slow drift on ghost track
  });
  ```
- [ ] On coasting state: the effect re-runs naturally (track state change triggers dep change) — the longer `duration: 3` gives the "ghost drift" feel
- [ ] On expiry: `setFollowDrone(null)` is already called in `pushDroneTrack` (Task 5)
- [ ] Run `pnpm typecheck`

---

## Task 11 — Wire `DroneTrackLayer` and `droneWorker` into `Map3D` / `page.tsx`

**Files:** modify `apps/web/src/components/Map3D.tsx`, modify `apps/web/src/app/page.tsx`

- [ ] In `Map3D.tsx`: after the viewer is initialised (inside the `useEffect([], [])` mount), render `<DroneTrackLayer viewer={viewerRef.current} />` — or, if `DroneTrackLayer` directly reads `viewerRef` from a shared context/prop, pass it appropriately; match the pattern used for existing Cesium layers in the file
- [ ] In `apps/web/src/app/page.tsx`: add `<DroneDetailPanel />` adjacent to the existing `<EventDetail />` (both are conditional slide-ins; no layout conflict)
- [ ] Spin up `droneWorker` in a new `useEffect` in `page.tsx` (or in a dedicated hook `apps/web/src/lib/useDroneWorker.ts`):
  - Spawn `new Worker(new URL("../components/droneWorker.ts", import.meta.url), { type: "module" })`
  - On each `droneTracks` change: post `{ type: "classify", track, locations }` for each active/coasting track (debounce as per Task 7)
  - On worker message `{ type: "classification" }`: call `setDroneClassification(data.trackId, data.data)`
  - Terminate worker on component unmount
- [ ] Run `pnpm typecheck && pnpm lint`

---

## Task 12 — End-to-end smoke test + iterate

- [ ] Start fabric (`pnpm dev` in `apps/fabric`)
- [ ] Start web (`pnpm dev` in `apps/web`)
- [ ] Using `mosquitto_pub` or a small Node script, publish a synthetic drone detection frame to the configured MQTT broker:
  ```json
  { "ts": "<ISO>", "nodeId": "node-1", "doppler": [0.1, 0.3, 0.7], "rssi": -55, "rangeM": 120 }
  ```
- [ ] Confirm in order:
  - [ ] Fabric logs: frame received, `IngestEvent { category: "drone" }` persisted
  - [ ] WebSocket: `drone-track` envelope received in browser DevTools WS inspector
  - [ ] Zustand store (DevTools): `droneTracks` has one entry, `state: "active"`
  - [ ] Map3D: Cesium globe shows billboard and Range Ring at node coordinates
  - [ ] Stop publishing frames for 6 s; confirm track transitions to `"coasting"` (dashed trail)
  - [ ] Stop publishing for 60 s; confirm track removed from store
  - [ ] DroneDetailPanel: opens when `followDroneId` is set, shows all inference fields
  - [ ] THREATCON: publish an `extreme`-severity drone frame; confirm THREATCON score increases ≥ 2.0 on next 15 s cycle
  - [ ] Alert rules: create a rule with `categories: ["drone"]`, `minSeverity: "high"`; publish a `high` severity frame; confirm siren fires and firing appears in `/rules`
- [ ] Hand off to `evanflow-iterate` for self-review pass
- [ ] **Stop. Report what was done. Await user direction on staging and commit.**

---

## Definition of Done

- `pnpm typecheck` and `pnpm lint` pass clean
- All new unit tests pass (`drone.test.ts`, `drone-rf.test.ts`, `threatcon.test.ts`)
- Smoke-test checklist above fully green
- No auto-commit, no auto-stage — user controls all git operations
