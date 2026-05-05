# Glossary

Terms specific to this codebase, ordered for skimming.

### THREATCON
0–10 numeric score and a 5-band level (`nominal | guarded | elevated | high | critical`) computed every 15 seconds in `apps/fabric/src/threatcon.ts`. Driven by event severity, recency, and proximity to your saved Locations. Rendered in `AssessmentPanel.tsx`. See [features/threatcon-pir](../features/threatcon-pir.md).

### PIR (Priority Intelligence Requirement)
Four boolean-ish questions ("Are family/work in danger?" etc.) computed alongside THREATCON. Each PIR has a `question`, an `answer` of `yes | no | unknown`, an optional `detail` line, and references the event IDs that contributed. Schema: `packages/schemas/src/index.ts → PIR`.

### Connector
A self-contained module under `packages/connectors/src/sources/*.ts` that knows how to talk to one external feed. Each connector exports a `Connector<TCfg>` (see `packages/connectors/src/types.ts`) with `id`, `label`, `category`, `authKind`, `configSchema`, `defaultConfig`, and an async `run(ctx)` loop.

### Connector instance
A row in the `instances` SQLite table. One *connector* (`nws-alerts`) can have many *instances* (one per area/region). The orchestrator runs one `AbortController` per instance.

### Orchestrator
`apps/fabric/src/orchestrator.ts`. Owns the lifecycle of all connector instances: start, stop, update config, persist events, emit Node `EventEmitter` events for downstream listeners (THREATCON loop, RuleEngine, WebSocket broadcast).

### Fabric
The Fastify backend (`apps/fabric/`). Borrowed terminology from "data fabric" — a single in-process bus that connects 22 producers to N consumers without intermediate brokers.

### IngestEvent
The canonical event shape. `id`, `source`, `connectorId`, `category`, `severity`, `title`, `summary`, `occurredAt`, `receivedAt`, optional `geo`, `geoMentioned`, `payload`, `icon`, `url`. Schema in `packages/schemas/src/index.ts → IngestEvent`.

### EventCategory
One of `weather | seismic | air | transport | power | water | news | iot | cv | space | finance | social | fire | lightning | health | other`.

### Severity
One of `info | low | moderate | high | extreme`. Numeric rank used internally: `info=0, low=1, moderate=2, high=3, extreme=4`.

### Location
A user-saved point of interest with a radius. Schema:
```ts
{ id, label, geo: {lat,lon}, radiusKm, kind: "home"|"work"|"school"|"family"|"other" }
```
Used by THREATCON ("Severe weather within 30 km of DC HQ") and by alert rules (`nearLocationId` + `nearKm`).

### AOI (Area of Interest)
A polygon stored in the `aois` SQLite table and exposed at `GET /api/aois`. Used by `Map2D.tsx` for click-to-select. Distinct from a Location: an AOI is a region, a Location is a centre + radius.

### CameraFeed
Schema `{ id, label, source, kind: "rtsp"|"hls"|"mjpeg"|"webcam"|"youtube", geo?, whepUrl?, hlsUrl?, detectors[] }`. Stored in the `cameras` SQLite table; rendered by `CameraTile.tsx`.

### Detector
A label in the `detectors` array on a `CameraFeed`. One of `motion | person | vehicle | fire | plate`. The `cvWorker.ts` Web Worker uses pixel heuristics to fire each detector. See [features/computer-vision](../features/computer-vision.md).

### CV event
An `IngestEvent` with `category: "cv"` produced by `POST /api/cv-event`. The fabric persists, broadcasts, and threats them like any other event. Cooldown is per-detector at 6 s in `cvWorker.ts`.

### Analyst
The right-rail chat panel powered by an in-browser LLM. Component: `apps/web/src/components/AnalystPanel.tsx`. Pipelines: `apps/web/src/lib/ai.ts`. See [features/ai-analyst](../features/ai-analyst.md).

### Overseer
The autonomous agent panel. Component: `apps/web/src/components/OverseerPanel.tsx`. Planner: `apps/web/src/lib/agent.ts`. Only acts on DOM nodes with a `data-agent="…"` attribute. See [features/overseer-agent](../features/overseer-agent.md).

### `data-agent="…"` attribute
The Overseer's allowlist. Every interactive element the agent should be able to click/inspect carries this attribute. Examples: `data-agent="add-camera"`, `data-agent="overseer-start"`, `data-agent="camera-strip"`. Search the codebase: `rg 'data-agent='`.

### THREATCON / PIR loop
The 15-second `setInterval` in `apps/fabric/src/index.ts → startThreatLoop()`. It re-runs `computeThreatcon` and `computePIR` and broadcasts both via WebSocket.

### Alert rule
A persisted `AlertRule` in the `alert_rules` table with a condition (categories/severity/keywords/bbox/near-location/rate-limit) and a notification spec (desktop/sound + soundKind: chime|siren|tone|none + severity floor). Evaluated by `apps/fabric/src/alerts.ts → RuleEngine` after every event. See [features/alert-rules](../features/alert-rules.md).

### Alert firing
An evaluation that matched, persisted to `alert_firings`. Schema: `{ id, ruleId, ruleLabel, event, firedAt, reason }`. Broadcast as `{type:"alert"}` over WebSocket.

### THREATCON snapshot vs WebSocket push
On WebSocket connect, the fabric pushes a `snapshot` envelope (last 200 events) plus the current `status`, `rules`, and computed `threatcon`/`pir`. Subsequent updates arrive as one envelope per change.

### WHEP
WebRTC-HTTP Egress Protocol. The standard the [`go2rtc`](https://github.com/AlexxIT/go2rtc) sidecar speaks for low-latency RTSP→browser playback. `CameraTile.tsx → playWhep()` does an SDP offer/answer round-trip with `POST {whepUrl}`. See [apps/web § cameras](../apps/web.md#camerastrip-cameratile).

### Time window / DVR
The `timeWindow` Zustand store key (`{from, to}` Unix-ms or `null` for live). When set, `IntelFeed`, `Map3D`, and `Map2D` filter their event arrays to events whose `occurredAt` falls inside the window. UI: `TimeScrubber.tsx`. See [features/dvr-time-scrubber](../features/dvr-time-scrubber.md).

### Follow entity
Zustand store key `followEntity: { kind: "icao24" | "id", value }`. When set to an ICAO24, `Map3D` keeps the camera centred on the corresponding aircraft as new positions arrive. Used by the EventDetail flyout's "Follow aircraft" button.

### Briefing
A multi-paragraph natural-language summary of the current situation, generated by `AnalystPanel` from `GET /api/briefing-context` (top events + counts + THREATCON + PIRs) and the in-browser LLM. See [features/briefing-generator](../features/briefing-generator.md).

### Topic worker
`apps/web/src/components/topicWorker.ts`. A Web Worker running `Xenova/nli-deberta-v3-xsmall` zero-shot classification to tag events with semantic topics ("infrastructure", "violence", "health emergency", …) when the title is ambiguous.

### `IngestEvent.payload`
Free-form `Record<string, any>` carrying connector-specific data (e.g., the OpenSky aircraft vector, the Wikipedia change diff, the NWS alert XML). The browser may safely read named keys but should never assume a global shape.

### Sandbox (Overseer)
The set of constraints in `apps/web/src/lib/agent.ts` that prevent the agent from doing damage: only `data-agent` clicks, no XHR, no global `eval`, mission step budget, Esc-to-abort. See [features/overseer-agent](../features/overseer-agent.md#sandbox-properties).

### Snapshot
Two unrelated meanings:
1. The first WebSocket envelope — a bulk dump of the last 200 events.
2. In the Overseer agent, a screenshot of the current viewport via `html-to-image` for the vision loop.
