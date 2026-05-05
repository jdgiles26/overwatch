# Architecture

Overwatch has two long-running processes and a set of optional sidecars:

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (apps/web · Next.js 15 · React 19)                     │
│                                                                 │
│  ┌──────────────┐  ┌──────────────────────────┐  ┌───────────┐  │
│  │  IntelFeed   │  │  MapView                 │  │ Assess.   │  │
│  │  (TimeScrub) │  │  Map3D (Cesium)          │  │ THREATCON │  │
│  │              │  │  Map2D (MapLibre +heat)  │  │ PIR       │  │
│  └──────────────┘  └──────────────────────────┘  │ Sources   │  │
│  ┌──────────────────────────────────────────┐    └───────────┘  │
│  │ CameraStrip → CameraTile (×N)            │                   │
│  │   ↳ cvWorker.ts (Web Worker)             │                   │
│  └──────────────────────────────────────────┘                   │
│  Pop-outs: Analyst (LLM), Overseer (agent), EventDetail,        │
│  CommandPalette (Cmd+K), Rules, Connectors                      │
└──────────┬──────────────────────────────────────┬──────────────┘
           │ HTTP /fabric/api/*  (rewrite)         │ ws://localhost:4311/ws
           │ WebGPU LLM (transformers.js)          │
           ▼                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  apps/fabric (Fastify 5, single Node process, port 4311)        │
│                                                                 │
│   REST API ──── Orchestrator ───── 22 Connectors                │
│       │              │                                          │
│       │              ├─→ ThreatCon engine (every 15s)           │
│       │              ├─→ PIR engine                             │
│       │              └─→ RuleEngine → AlertFiring               │
│       │                                                         │
│       └─→ SQLite (better-sqlite3, WAL, AES-256-GCM keystore)    │
│           events · instances · cameras · locations              │
│           alert_rules · alert_firings · aois                    │
└──────┬──────────────────────────────────────────────────────────┘
       │ HTTP/MQTT/WS to public APIs
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  Public feeds                                                   │
│    NWS · USGS · NASA EONET · ISS · OpenAQ · OpenSky · GDELT     │
│    HackerNews · Wikipedia · SpaceX · Open-Meteo · Reddit        │
│    GitHub events · CoinGecko · MQTT brokers · Webhooks          │
│    RSS · NOAA SWPC · EMSC · NASA FIRMS · REST · Simulator       │
│                                                                 │
│  Optional sidecar:                                              │
│    go2rtc :1984  ── RTSP/RTMP → WHEP/HLS/MJPEG                  │
└─────────────────────────────────────────────────────────────────┘
```

## The two services

### `apps/fabric` — backend

A single Node process. Responsibilities:

1. **Persist state** — `apps/fabric/src/db.ts` opens a `better-sqlite3` database at `OVERWATCH_DB` (defaults to `apps/fabric/data/overwatch.db`), in WAL mode, and creates seven tables: `events`, `instances`, `cameras`, `locations`, `alert_rules`, `alert_firings`, `aois`. Connector configs are encrypted at rest using a 32-byte key generated on first boot at `OVERWATCH_KEY_PATH` and AES-256-GCM (see [security](../reference/dependencies.md#security)).
2. **Run connectors** — `apps/fabric/src/orchestrator.ts` reads enabled instances from the `instances` table, creates an `AbortController` per instance, and calls each connector's `run(ctx)` function. Connectors emit `IngestEvent` objects which the orchestrator persists, deduplicates by `id`, and re-emits as a Node `EventEmitter`.
3. **Compute THREATCON + PIR** — every 15 seconds (see `apps/fabric/src/index.ts:startThreatLoop`), `apps/fabric/src/threatcon.ts` runs a deterministic scoring function over the most recent 1,000 events, weighted by severity, recency, and proximity to your saved Locations. It produces a 0–10 `ThreatCon` and four `PIR` answers ("Are family/work in danger?" "Is critical infrastructure stressed?" etc.).
4. **Evaluate alert rules** — `apps/fabric/src/alerts.ts` `RuleEngine` runs after every event. Each rule has a condition (categories, minSeverity, keywords, bbox, near-location radius, rate limit) and produces an `AlertFiring` that is broadcast and persisted.
5. **Serve REST + WS** — Fastify 5 with `@fastify/cors` and `@fastify/websocket`. REST under `/api/*` (see [reference/configuration](../reference/configuration.md)); WebSocket at `/ws` broadcasts a discriminated union of `event | status | threatcon | pir | hello | snapshot | alert | rules` envelopes.

### `apps/web` — frontend

Next.js 15 App Router (`apps/web/src/app/page.tsx` is the only "real" route — `/connectors` and `/rules` are CRUD pages). Three top-level pieces of client-side state:

- **Zustand store** (`apps/web/src/lib/store.ts`) — events array (capped at 2000), connector status, locations, cameras, threatcon, pirs, view mode (`map3d` / `map2d` / `split`), filters, selected event, fly-to target, alert rules and firings, **timeWindow** (DVR), **followEntity** (aircraft trail follow).
- **WebSocket bridge** (`apps/web/src/lib/ws.ts`) — connects to `NEXT_PUBLIC_FABRIC_WS`, parses `ServerToClient` envelopes, and dispatches into the store. Also auto-fetches THREATCON/PIR on snapshot.
- **AI pipelines** (`apps/web/src/lib/ai.ts`) — caches Hugging Face Transformers.js pipelines per task. The Analyst uses `text-generation`, the topic worker uses `zero-shot-classification`, voice STT uses `automatic-speech-recognition` with `Xenova/whisper-tiny.en`.

Next.js is configured with COOP/COEP headers (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: credentialless`) so that WebGPU and `SharedArrayBuffer` work for transformers.js (see `apps/web/next.config.mjs`). The `/fabric/:path*` rewrite proxies anything under `/fabric/` to the fabric URL (default `http://localhost:4311`) so the dashboard can talk to fabric on the same origin in dev.

## The data flow of one event

1. A connector — say `apps/fabric/src/orchestrator.ts` running `nws-alerts.ts` — fetches `https://api.weather.gov/alerts/active`, deduplicates against an in-memory `Set<string>` of seen IDs, and calls `ctx.emit({…})` for each new alert.
2. The orchestrator stamps `connectorId`, `source`, and `receivedAt`, validates against the [`IngestEvent`](../packages/schemas.md#ingestevent) Zod schema, and `INSERT OR REPLACE`s into SQLite.
3. The orchestrator's `EventEmitter` re-emits `event`, which `apps/fabric/src/index.ts` listens to. It calls `ruleEngine.evaluate(ev)` (see [features/alert-rules](../features/alert-rules.md)) and broadcasts the event to every connected WebSocket client as `{type:"event", data:…}`.
4. In the browser, `apps/web/src/lib/ws.ts` routes the envelope into Zustand via `addEvent(e)`. The store deduplicates by ID and caps the array at 2,000 entries.
5. Three React components subscribe to the events array:
   - `IntelFeed.tsx` — re-applies the current filter (categories/severities/query/timeWindow) and renders cards.
   - `Map3D.tsx` — projects each event with a `geo` onto the Cesium globe, plus draws ICAO-24 aircraft trails when present.
   - `Map2D.tsx` — drops markers and feeds the heatmap layer.
6. If a rule fired, a separate `{type:"alert"}` envelope arrives. `apps/web/src/lib/ws.ts` calls `notifyAlert()` (`apps/web/src/lib/notify.ts`), which plays a WebAudio chime/siren/tone and shows a desktop notification.
7. If the user clicks the event, `apps/web/src/components/EventDetail.tsx` opens, computes related events by category/severity/geographic proximity, and offers an "Ask analyst" button that pushes a pre-filled prompt into the analyst panel.

## The five "vertical" features

These don't fit cleanly into the apps/packages split — they thread state through several files:

- **THREATCON / PIR** — `apps/fabric/src/threatcon.ts` produces it; `AssessmentPanel.tsx` shows it. See [features/threatcon-pir](../features/threatcon-pir.md).
- **Alert Rules** — `apps/fabric/src/alerts.ts` evaluates; `apps/web/src/app/rules/page.tsx` is the CRUD UI; `apps/web/src/lib/notify.ts` plays sounds; `TopBar.tsx` shows the firing badge. See [features/alert-rules](../features/alert-rules.md).
- **Time scrubber / DVR** — store key: `timeWindow`. Read by `IntelFeed.tsx`, `Map3D.tsx`, `Map2D.tsx`. UI in `TimeScrubber.tsx`. See [features/dvr-time-scrubber](../features/dvr-time-scrubber.md).
- **Overseer agent** — `OverseerPanel.tsx` is the chrome; `apps/web/src/lib/agent.ts` is the planner. Only acts on elements tagged `data-agent="…"`. See [features/overseer-agent](../features/overseer-agent.md).
- **Computer vision** — per-tile `cvWorker.ts` Web Worker posts findings to `POST /api/cv-event` which the fabric round-trips back as a regular `cv` event. See [features/computer-vision](../features/computer-vision.md).

## Threading model

- **Main thread (browser)** — React render, MapLibre 2D, Cesium 3D, Zustand updates, WebSocket consumer.
- **Web Worker(s)** — one `cvWorker.ts` per camera tile that has detectors enabled; one `topicWorker.ts` for zero-shot tagging.
- **Worker (transformers.js internal)** — analyst LLM and Whisper STT run on the WebGPU device when available, falling back to WASM.
- **Service Worker** — `apps/web/public/sw.js` for the [PWA](../features/pwa.md) offline shell.
- **Node main thread (fabric)** — Fastify event loop, connector polling loops, the 15s `setInterval` that recomputes THREATCON.

## What's *not* here

- **No Redis, no Kafka, no message broker.** SQLite + Node `EventEmitter` is the bus.
- **No multi-tenant auth.** The app is a single-user console; there is no login screen.
- **No tests.** 0 `.test.*` or `.spec.*` files in the tree. See [fun-facts](./fun-facts.md).
- **No `packages/agent`, `packages/ai`, `packages/cv`, `packages/ui` code.** All four workspaces are empty placeholders; their logic lives inline in `apps/web/src/lib/` and `apps/web/src/components/`.
