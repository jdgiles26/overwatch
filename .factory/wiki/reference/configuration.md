# Configuration reference

Every knob the codebase reads at runtime. The defaults work locally with no `.env` at all — every variable is optional. See [overview/getting-started](../overview/getting-started.md) for a quick checklist of which ones unlock which features.

## Environment variables

All variables (and their defaults) come from `/.env.example`:

```bash
# Optional API keys for upgraded connectors. Leave blank for free tier.
OPENAQ_API_KEY=
OPENSKY_USERNAME=
OPENSKY_PASSWORD=
NASA_FIRMS_MAP_KEY=
GITHUB_TOKEN=
NEXT_PUBLIC_CESIUM_ION_TOKEN=
NEXT_PUBLIC_GO2RTC_URL=http://localhost:1984
NEXT_PUBLIC_FABRIC_WS=ws://localhost:4311
FABRIC_URL=http://localhost:4311
FABRIC_PORT=4311
OVERWATCH_DB=./data/overwatch.db
OVERWATCH_KEY_PATH=./data/key.bin
```

| Var | Type | Default | Read by | Effect |
|---|---|---|---|---|
| `FABRIC_PORT` | int | `4311` | `apps/fabric/src/index.ts` | Fastify listen port. `Number(process.env.FABRIC_PORT ?? 4311)`. |
| `FABRIC_URL` | URL | `http://localhost:4311` | `apps/web/next.config.mjs:rewrites()` | Where Next.js proxies `/fabric/*` to. |
| `OVERWATCH_DB` | path | `./data/overwatch.db` | `apps/fabric/src/db.ts` | SQLite file. The directory is auto-created. |
| `OVERWATCH_KEY_PATH` | path | `./data/key.bin` | `apps/fabric/src/db.ts → getOrMakeKey()` | 32-byte AES-256-GCM key. Generated on first boot with mode `0o600` if missing. |
| `NEXT_PUBLIC_FABRIC_WS` | URL | `ws://localhost:4311` | `apps/web/src/lib/ws.ts` | WebSocket origin for the dashboard. The path `/ws` is appended internally. |
| `NEXT_PUBLIC_GO2RTC_URL` | URL | `http://localhost:1984` | `apps/web/src/components/CameraTile.tsx` | Base URL of the go2rtc sidecar; used to derive WHEP endpoints (`{base}/api/whep?src={name}`). |
| `NEXT_PUBLIC_CESIUM_ION_TOKEN` | string | unset | `apps/web/src/components/Map3D.tsx` | Cesium Ion access token. If unset the globe falls back to OSM raster tiles. |
| `NASA_FIRMS_MAP_KEY` | string | unset | `packages/connectors/src/sources/nasa-firms.ts` | Required to fetch FIRMS active fire pixels. |
| `OPENAQ_API_KEY` | string | unset | `packages/connectors/src/sources/openaq.ts` | Higher rate limits on the OpenAQ v3 endpoints. |
| `OPENSKY_USERNAME` / `OPENSKY_PASSWORD` | string | unset | `packages/connectors/src/sources/opensky.ts` | Doubles the rate limit and unlocks extended ICAO24 vectors. |
| `GITHUB_TOKEN` | string | unset | `packages/connectors/src/sources/github-events.ts` | Bumps the `/events` rate limit from 60/hr to 5000/hr. |

`NEXT_PUBLIC_*` is the Next.js convention for variables that get inlined into the browser bundle — anything else is server-only.

## Default-derivation details

- `OVERWATCH_KEY_PATH` is read with `fs.readFileSync(KEY_PATH)`; on `ENOENT` the code does `mkdirSync(dirname(KEY_PATH), { recursive: true })` and writes 32 random bytes (`crypto.randomBytes(32)`) at mode `0o600`. There is no opt-in; the keystore is always created.
- `OVERWATCH_DB` is opened by `better-sqlite3` with `journal_mode = WAL` and `synchronous = NORMAL`. The directory is created the same way.
- `FABRIC_URL` is also baked into the docker-compose `web` service as `http://fabric:4311` (DNS to the sibling container).
- `NEXT_PUBLIC_FABRIC_WS` defaults to `ws://localhost:4311` even inside the docker-compose web container — see `infra/docker-compose.yml`. The browser, not the container, performs the WebSocket connection.

## REST endpoints

All routes live in `apps/fabric/src/index.ts`. Plain JSON in/out. No auth. CORS is `origin: true` (wide open).

### Health

| Method | Path | Body | Response | Source |
|---|---|---|---|---|
| GET | `/health` | — | `{ ok: true, time: ISO }` | `app.get("/health", …)` |

### Connectors

| Method | Path | Body | Response | Source |
|---|---|---|---|---|
| GET | `/api/connectors/catalog` | — | `Array<ConnectorDefinition & { defaults, configFields }>` | `extractFields()` walks `c.configSchema._def.shape()` |
| GET | `/api/connectors/status` | — | `ConnectorStatus[]` | `orchestrator.allStatus()` |
| POST | `/api/connectors` | `{ connectorId, label?, config?, enabled? }` | `{ id }` | `orchestrator.addInstance(...)` |
| PATCH | `/api/connectors/:id` | `{ label?, config?, enabled? }` | `{ ok: true }` | `orchestrator.updateInstance(...)` |
| DELETE | `/api/connectors/:id` | — | `{ ok: true }` | `orchestrator.removeInstance(...)` |

`configFields[i]` shape: `{ key, kind, options?, default, description? }` where `kind ∈ "string"|"number"|"boolean"|"enum"|"array"|"object"|"record"|"tuple"`.

### Events

| Method | Path | Query | Response | Source |
|---|---|---|---|---|
| GET | `/api/events` | `bbox=minLon,minLat,maxLon,maxLat&limit=2000` (optional) | `IngestEvent[]` | `eventsByBbox(...)` if bbox parses to 4 finite numbers, else `recentEvents(limit ?? 500)` |

### Locations / Cameras

```ts
GET    /api/locations           -> Location[]
POST   /api/locations           -> { ok: true }   // body: full Location
DELETE /api/locations/:id       -> { ok: true }

GET    /api/cameras             -> CameraFeed[]   // detectors JSON-decoded
POST   /api/cameras             -> { ok: true }
DELETE /api/cameras/:id         -> { ok: true }
```

### THREATCON / PIR

| Method | Path | Response | Source |
|---|---|---|---|
| GET | `/api/threatcon` | `{ threatcon: ThreatCon, pir: PIR[] }` | `computeThreatcon(events, locations)` + `computePIR(...)` over `recentEvents(1000)` |

The 15s broadcast loop (`startThreatLoop()`) recomputes the same data and pushes it via WebSocket.

### Webhook ingest

| Method | Path | Body | Response | Source |
|---|---|---|---|---|
| POST | `/ingest/:key` | arbitrary JSON | `{ ok: true }` or `404 { error }` | `getWebhookRouter().get(key)` |

The webhook router is a process-global `Map<string, (body) => void>` populated by every active `webhook` connector instance. If no instance has registered for `:key`, the route returns 404 — no events are persisted.

### CV events (browser-pushed)

| Method | Path | Body | Response | Source |
|---|---|---|---|---|
| POST | `/api/cv-event` | `{ id?, title, summary?, severity?, geo?, payload?, occurredAt?, icon? }` | `{ ok: true }` or `400 { error: "title required" }` | Persists with `category: "cv"`, `connectorId: "browser-cv"`, `source: body.source ?? "browser-cv"` |

The fabric synthesises `id` (`cv-${Date.now()}-${rand}`) and `receivedAt` if missing, then `persistEvent()` and `broadcast({type:"event", data})`. See [features/computer-vision](../features/computer-vision.md).

### Alert rules

```ts
GET    /api/rules              -> AlertRule[]
POST   /api/rules              -> AlertRule    // 400 { error: "label required" } if missing
DELETE /api/rules/:id          -> { ok: true }
GET    /api/firings?limit=100  -> AlertFiring[] // ordered by fired_at DESC
```

POST applies these defaults if absent on the body:

```ts
{
  id: `rule_${randomHex(5)}`,
  enabled: true,
  notify: { desktop: true, sound: true, soundKind: "chime", severityFloor: "moderate" },
  condition: { categories: [], keywords: [], rateLimitMs: 60_000, ... },
}
```

After upsert it calls `ruleEngine.reload()` which re-emits `rules` over the WebSocket.

### AOIs (areas of interest)

```ts
GET    /api/aois               -> { id, label, polygon: [[lon,lat], ...] }[]
POST   /api/aois               -> { ok: true }   // synthesises id and label if missing
DELETE /api/aois/:id           -> { ok: true }
```

Consumed only by `apps/web/src/components/Map2D.tsx` for click-to-select.

### Briefing context

| Method | Path | Response | Source |
|---|---|---|---|
| GET | `/api/briefing-context` | `{ threatcon, pir, counts: Record<EventCategory, number>, top: Array<{ id, cat, sev, title, where: [lat,lon]?, when, src }> }` | Top 30 events ordered by severity rank descending |

The `AnalystPanel.runBriefing()` path (`apps/web/src/components/AnalystPanel.tsx`) `apiGet`s this and feeds it to the in-browser LLM.

## WebSocket envelope types

Path: `GET /ws` (upgrade). The fabric immediately sends four messages on connect: `hello`, `snapshot`, `status`, `rules`. Subsequent messages are produced by orchestrator events and the 15s threat loop.

The full discriminated union from `packages/schemas/src/index.ts → ServerToClient` (8 types):

```ts
ServerToClient = z.discriminatedUnion("type", [
  { type: "event",     data: IngestEvent },
  { type: "status",    data: ConnectorStatus[] },
  { type: "threatcon", data: ThreatCon },
  { type: "pir",       data: PIR[] },
  { type: "hello",     data: { sessionId: string, ts: string } },
  { type: "snapshot",  data: { events: IngestEvent[] } },
  { type: "alert",     data: AlertFiring },
  { type: "rules",     data: AlertRule[] },
]);
```

Producers:

| Type | Producer in `apps/fabric/src/index.ts` |
|---|---|
| `hello` | first message on socket open: `{ sessionId: random36, ts: ISO }` |
| `snapshot` | second message on open: `{ events: recentEvents(200) }` |
| `status` | third on open + `orchestrator.on("status")` |
| `rules` | fourth on open + `ruleEngine.on("rules")` |
| `event` | `orchestrator.on("event", ev)` |
| `alert` | `for (const firing of ruleEngine.evaluate(ev)) broadcast({type:"alert", data: firing})` |
| `threatcon` | every 15s in `startThreatLoop()` |
| `pir` | every 15s in `startThreatLoop()` |

`ClientToServer` (2 types):

```ts
ClientToServer = z.discriminatedUnion("type", [
  { type: "subscribe", data: { categories?: EventCategory[], bbox?: [n,n,n,n] }.default({}) },
  { type: "ping",      data: {}.default({}) },
]);
```

The fabric currently **ignores** all client messages — the `socket.on("message", () => { /* subscriptions handled by bbox on GET */ })` handler is a no-op. The schema is reserved for forward compatibility.

## Configuration that is *not* env-driven

- **CORS origin** — hard-coded `origin: true` in `apps/fabric/src/index.ts`. To restrict, edit the `app.register(cors, { origin: ... })` call.
- **Event cap** — `apps/web/src/lib/store.ts` caps the in-memory events array at 2,000 entries (deduped by `id`). The fabric does not cap; the SQLite `events` table grows forever (see [reference/deployment § production hardening](./deployment.md#production-hardening)).
- **THREATCON loop interval** — hard-coded 15,000 ms in `apps/fabric/src/index.ts:startThreatLoop()`.
- **Rule rate limit** — `condition.rateLimitMs` is per-rule, default `60_000` ms. See [packages/schemas](../packages/schemas.md#alertrule-and-alertfiring).
- **Event ring buffer for status** — `orchestrator.allStatus()` filters timestamps within 60s and 3600s windows. Hard-coded.
- **CSP / COOP / COEP** — set in `apps/web/next.config.mjs`. See [reference/security](./security.md#coop-coep).

## See also

- [overview/getting-started](../overview/getting-started.md) — concrete first-run steps and which envs unlock which features.
- [reference/data-models](./data-models.md) — schemas referenced in the table above.
- [reference/deployment](./deployment.md) — Dockerfile env wiring.
- [apps/fabric](../apps/fabric.md) — the REST + WebSocket surface in narrative form.
