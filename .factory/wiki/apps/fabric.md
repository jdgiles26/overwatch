# apps/fabric — the data fabric

A single Fastify 5 process. 1,070 lines across 5 files. It owns the SQLite database, runs all 22 connectors, computes THREATCON every 15 s, evaluates [alert rules](../features/alert-rules.md), and broadcasts everything over a WebSocket.

```
apps/fabric/src/
├── index.ts          REST + WebSocket entry (260 LOC)
├── db.ts             SQLite + AES-GCM keystore (260 LOC)
├── orchestrator.ts   Connector lifecycle (170 LOC)
├── threatcon.ts      THREATCON + PIR engine (110 LOC)
└── alerts.ts         RuleEngine (100 LOC)
```

Run it with `pnpm --filter @overwatch/fabric dev` (uses `tsx watch`) or `pnpm --filter @overwatch/fabric start` (`tsx`).

## `index.ts` — the entry

The whole HTTP/WebSocket surface lives in one file. Routes by category:

### Connectors
- `GET /api/connectors/catalog` — every connector's static definition + Zod-derived `configFields`. The web app uses this to render the "Add connector" modal at `/connectors`.
- `GET /api/connectors/status` — runtime status from `orchestrator.allStatus()`.
- `POST /api/connectors` — `{ connectorId, label?, config?, enabled? }`. Creates an instance.
- `PATCH /api/connectors/:id` — `{ label?, config?, enabled? }`. Toggles or reconfigures.
- `DELETE /api/connectors/:id` — removes.

### Events
- `GET /api/events?bbox=minLon,minLat,maxLon,maxLat&limit=2000` — bbox query against the `events` table.
- `GET /api/events?limit=500` — most recent events, no filter.

### Locations / Cameras
Each is `GET / POST / DELETE /api/{locations|cameras}` plus `/:id`.

### THREATCON / PIR
- `GET /api/threatcon` — runs `computeThreatcon` and `computePIR` synchronously and returns the snapshot. The 15 s broadcast loop pushes the same data to all WebSocket clients.

### Webhooks
- `POST /ingest/:key` — generic webhook ingest. Looks up `getWebhookRouter().get(key)` (a `Map<string, handler>` populated by every active `webhook` connector instance) and calls the handler with the request body. Returns 404 if no connector is registered for that key.

### CV events (browser-pushed)
- `POST /api/cv-event` — accepts `{ id?, title, summary?, severity?, geo?, payload? }` from the browser's `cvWorker` and round-trips it as a regular `IngestEvent` with `category: "cv"`. See [features/computer-vision](../features/computer-vision.md).

### Alert rules (CRUD)
- `GET /api/rules` — `ruleEngine.list()`.
- `POST /api/rules` — accepts a partial rule, fills in defaults (`notify.desktop=true, sound=true, soundKind="chime", severityFloor="moderate"`, `condition.rateLimitMs=60000`), persists, and reloads the engine.
- `DELETE /api/rules/:id`.
- `GET /api/firings?limit=100` — recent rule firings from the `alert_firings` table.

### AOIs (areas of interest)
- `GET / POST / DELETE /api/aois`. Polygons stored as a JSON `[[lon,lat],…]` array in the `aois` table. The 2D map uses this for click-to-select; nothing else consumes it yet.

### AI briefing context
- `GET /api/briefing-context` — returns the structured snapshot the [briefing generator](../features/briefing-generator.md) feeds to the LLM:
  ```ts
  { threatcon, pir, counts: { [category]: n }, top: [{id,cat,sev,title,where:[lat,lon]?,when,src}, ×30] }
  ```

### WebSocket
- `GET /ws` — the long-lived connection. On open, the fabric immediately sends:
  1. `{type:"hello", data:{sessionId, ts}}`
  2. `{type:"snapshot", data:{events: lastN(200)}}`
  3. `{type:"status", data: orchestrator.allStatus()}`
  4. `{type:"rules", data: ruleEngine.list()}`

Subsequent messages are produced by:
- `orchestrator.on("event", ev)` → `{type:"event", data:ev}` + alert rule evaluation.
- `orchestrator.on("status", st)` → `{type:"status", data:st}`.
- `ruleEngine.on("rules", rules)` → `{type:"rules", data:rules}`.
- A 15 s `setInterval` (`startThreatLoop()`) → `{type:"threatcon"}` + `{type:"pir"}`.

The `broadcast()` function iterates a `Set<socket>` and `JSON.stringify`s once per envelope. Closed sockets are removed via the `socket.on("close", …)` handler.

### Plugins
Just two: `@fastify/cors` (`origin: true` — wide-open during dev) and `@fastify/websocket`. No auth middleware, no rate limiting.

## `db.ts` — SQLite + crypto

`better-sqlite3` opened at `OVERWATCH_DB` (default `./data/overwatch.db`), with `journal_mode = WAL` and `synchronous = NORMAL`. Seven tables, all created with `IF NOT EXISTS`:

| Table | Purpose |
|---|---|
| `events` | Every `IngestEvent`. Indexed by `received_at DESC`, `category`, `severity`. |
| `connector_instances` | One row per running connector. Stores AES-encrypted `config` blob. |
| `cameras` | Camera feed metadata. |
| `locations` | User Locations. |
| `alert_rules` | Alert rule definitions; `notify` and `condition` are JSON-encoded. |
| `alert_firings` | Persisted rule firings; `payload` is the JSON-encoded `IngestEvent`. Indexed by `fired_at DESC`. |
| `aois` | AOI polygons. |

Helper functions:
- `persistEvent(e)` — `INSERT OR REPLACE INTO events …`. Handles `geo`, `payload` JSON-encoding.
- `recentEvents(limit)`, `eventsByBbox(...)`, `rowToEvent(r)`.
- `listInstances`/`upsertInstance`/`deleteInstance` — connector lifecycle.
- `listCameras`/`upsertCamera`/`deleteCamera` — `detectors` is JSON-encoded.
- `listLocations`/`upsertLocation`/`deleteLocation`.
- `listRules`/`upsertRule`/`deleteRule` — JSON-encodes/decodes `notify` and `condition`.
- `listFirings(limit)`/`recordFiring(f)`.
- `listAois`/`upsertAoi`/`deleteAoi`.

### Crypto-at-rest

```ts
const KEY = getOrMakeKey();   // 32 random bytes at OVERWATCH_KEY_PATH (mode 0o600)
encrypt(plain)  -> base64(iv12 || tag16 || ciphertext)
decrypt(b64)    -> plaintext
```

AES-256-GCM with a fresh 12-byte IV per write. `encrypt`/`decrypt` are exported and used by the orchestrator before persisting / after loading `connector_instances.config`. See [reference/dependencies § security](../reference/dependencies.md).

## `orchestrator.ts` — connector lifecycle

The `Orchestrator` extends `EventEmitter`. State: `instances: Map<id, RunningInstance>`, where:

```ts
type RunningInstance = {
  id, connector, config, enabled,
  abort: AbortController,
  status: ConnectorStatus,
  buffer: number[],   // timestamps of recent emits, for rate stats
};
```

Lifecycle:
- `start()` — reads `listInstances()`, decrypts each config, calls `launch()`.
- `launch(id, connector, config, enabled, label)` — builds the `RunningInstance`, then `runOne(inst)` if enabled.
- `runOne(inst)` — calls `connector.run({ config, signal: inst.abort.signal, log, emit, now })`. The `emit` callback persists the event, pushes a timestamp into `inst.buffer`, and re-emits `event` from the orchestrator.
- `addInstance(connectorId, label, config, enabled)` — generates an `id`, persists, launches.
- `updateInstance(id, { label?, config?, enabled? })` — flips enabled on/off (`abort.abort()` to stop, fresh `AbortController` to restart). Re-encrypts and persists the new config.
- `removeInstance(id)` — abort, delete row.
- `allStatus()` — for each instance, recompute `eventsLastMinute` / `eventsLastHour` from `inst.buffer` filtered by 60 s / 3600 s windows.
- `stop()` — abort everything.

The orchestrator never serializes — every connector runs in parallel with its own infinite loop.

## `threatcon.ts` — THREATCON + PIR

Pure functions, easy to read end to end. See [features/threatcon-pir](../features/threatcon-pir.md) for the algorithm. Inputs: `events: IngestEvent[]`, `locations: Location[]`. Outputs: `ThreatCon` and `PIR[]`.

The proximity check uses `km(a, b)` from `@overwatch/connectors` (haversine, Earth radius 6371 km).

## `alerts.ts` — RuleEngine

`RuleEngine extends EventEmitter`:

- `reload()` — re-reads `listRules()` and emits `rules` (consumed by `index.ts` to broadcast).
- `evaluate(event) -> AlertFiring[]` — iterates rules, tests each condition, applies a per-rule `rateLimitMs` (default 60s) using `lastFire: Map<ruleId, ts>`. Matching firings are persisted via `recordFiring()` and emitted on `alert`.

Conditions supported (all optional, ANDed):
- `categories: EventCategory[]`
- `minSeverity: Severity` — uses `SEVERITY_RANK` lookup.
- `keywords: string[]` — case-insensitive substring search across `title + summary`.
- `bbox: [minLon, minLat, maxLon, maxLat]` — requires `event.geo`.
- `nearLocationId + nearKm` — requires `event.geo`; uses haversine to a saved Location.
- `rateLimitMs` — drops matches that fire too soon after the previous one.

The `reasons` array is built per match and embedded into the `AlertFiring.reason` string for transparency in the UI.

## Bootstrapping

```
1. KEY = read or generate 32 random bytes at OVERWATCH_KEY_PATH
2. db.exec(CREATE TABLE …)
3. orchestrator.start()
   ↳ for each row in connector_instances: decrypt config → launch
4. ruleEngine = new RuleEngine()  // loads rules from DB
5. orchestrator.on(event)  → broadcast + ruleEngine.evaluate
   orchestrator.on(status) → broadcast
   ruleEngine.on(rules)    → broadcast
6. setInterval(15s) → broadcast threatcon + pir
7. fastify.listen({ port: FABRIC_PORT, host: 0.0.0.0 })
8. SIGINT → clear interval, orchestrator.stop, db.close, app.close
```

## Threading and concurrency

- Single Node thread; everything is async I/O.
- 22+ connector loops run concurrently. Each `await sleep(intervalMs, signal)` between iterations yields to the event loop.
- `better-sqlite3` is **synchronous** — every DB call blocks the event loop briefly. With WAL and a small working set this is fine, but it means a slow disk could backpressure event ingestion.
- `JSON.stringify` of broadcast envelopes is also synchronous. With a few hundred connected clients it would matter; with one (the dashboard tab) it doesn't.

## Failure modes

- **Connector throws** → caught in `runOne()`, message appended to `status.errors[]` (last 5), `connected=false`. The connector is *not* automatically restarted; the user has to flip enabled off and on, or re-issue `PATCH /api/connectors/:id`.
- **Connector hot-loops on a bad URL** → same path; `ctx.log` adds the error and the loop sleeps `pollIntervalMs` before retrying. There is no exponential backoff in the connector contract; individual connectors implement their own.
- **WebSocket client disconnect** → handled by `socket.on("close", () => clients.delete(socket))`. The `broadcast()` function `try/catch`es the `send()` so dead sockets are tolerated until cleanup.
- **`recordFiring()` fails** → caught in `RuleEngine.evaluate`; the firing is still emitted and broadcast even if persistence failed.
- **DB corruption** → no recovery beyond deleting `data/overwatch.db` and re-seeding.

## What it doesn't do

- No auth, no API keys for `/api/*`, no rate limit. Anything that can reach `:4311` can manipulate state.
- No HTTPS. Run behind a reverse proxy if you expose it.
- No background DB compaction. SQLite WAL handles the hot path; `events` will grow forever otherwise.
- No outbound webhooks for alert firings — alerts are pushed *to the browser*, not to Slack/PagerDuty/etc.
- No replication, no clustering. One process, one machine.
