# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
pnpm install

# Development (run each in separate terminals)
pnpm --filter @overwatch/fabric dev     # fabric backend on :4311
pnpm --filter @overwatch/web dev        # Next.js frontend on :3311

# Seed demo data (fabric must be running)
pnpm seed

# Type-check all packages
pnpm typecheck

# Lint all packages
pnpm lint

# Run all tests
pnpm test

# Run tests for a single package
pnpm --filter @overwatch/fabric test
pnpm --filter @overwatch/connectors test

# Run a single test file
pnpm --filter @overwatch/fabric exec vitest run src/drone.test.ts

# Build everything
pnpm build

# Type-check + lint together (CI equivalent)
pnpm verify
```

## Architecture

This is a pnpm monorepo with three packages and two apps:

```
packages/schemas      Shared Zod schemas — IngestEvent, ThreatCon, PIR, DroneTrack,
                       CameraFeed, AlertRule, ServerToClient WS union, etc.
                       All domain types originate here. Import from @overwatch/schemas.

packages/connectors   23 data-source connectors (NWS, USGS, EMSC, EONET, OpenAQ,
                       OpenSky, ISS, GDELT, HN, Reddit, GitHub, Open-Meteo,
                       CoinGecko, SpaceX, NOAA SWPC, Wikipedia RC, NASA FIRMS,
                       MQTT, Webhook, RSS, REST poller, Demo simulator, Drone RF).
                       Each connector exports a ConnectorDef with a configSchema (Zod),
                       defaultConfig, and a start(cfg, emit) factory.

apps/fabric           Fastify + better-sqlite3 backend on port 4311.
                       - orchestrator.ts: lifecycle manager for connector instances;
                         persists enabled state to SQLite; emits "event"/"status" events
                       - db.ts: SQLite via better-sqlite3 (WAL mode); AES-256-GCM
                         encryption for connector configs; tables: events, locations,
                         cameras, rules, firings, aois, connector_instances
                       - threatcon.ts: derives ThreatCon level + PIRs from recent events
                       - alerts.ts: RuleEngine evaluates AlertRules against incoming events
                       - drone.ts: DroneAggregator — correlates RF detections into tracks
                       - index.ts: REST API + /ws WebSocket hub; broadcasts ServerToClient
                         messages to all connected clients

apps/web              Next.js 15 / React 19 dashboard on port 3311.
                       - lib/store.ts: single Zustand store — all UI state lives here
                       - lib/ws.ts: useFabricSocket() hook — connects to fabric WS,
                         dispatches typed messages into the store
                       - lib/agent.ts: Overseer autonomous agent (screenshots → caption
                         → DOM outline → action dispatch)
                       - lib/ai.ts: on-device LLM via @huggingface/transformers (WebGPU/WASM)
                       - components/Map3D.tsx: Cesium globe
                       - components/Map2D.tsx: MapLibre 2D map
                       - components/AnalystPanel.tsx: chat UI backed by on-device LLM
                       - components/CameraStrip.tsx + CameraTile.tsx: camera feeds
                       - components/visionWorker.ts: browser Web Worker for per-camera
                         AI detection (LFM2.5-VL-450M-ONNX VLM, WebGPU/WASM); emits cv
                         events back to fabric via POST /api/cv-event
                       - components/droneWorker.ts: browser Web Worker for drone RF
                         signal processing and heuristic threat classification
```

### Data flow

```
Connectors → orchestrator "event" → fabric index.ts broadcast() → WebSocket /ws
                                   → RuleEngine.evaluate() → broadcast "alert"
                                   → DroneAggregator.process() → broadcast "drone-track"
                                   → SQLite (persistEvent)

Browser → useFabricSocket() → Zustand store → React components
        → visionEngine (→ visionWorker) → POST /api/cv-event
        → droneWorker → drone-rf WS
```

### Key environment variables

| Variable | Default | Purpose |
|---|---|---|
| `FABRIC_PORT` | `4311` | Fabric HTTP/WS port |
| `OVERWATCH_DB` | `./data/overwatch.db` | SQLite path |
| `OVERWATCH_KEY_PATH` | `./data/key.bin` | AES-256-GCM key for connector config encryption |
| `NEXT_PUBLIC_FABRIC_WS` | `ws://localhost:4311` | WebSocket URL used by browser |
| `NEXT_PUBLIC_FABRIC_URL` | `http://localhost:4311` | REST API base URL used by browser |

### Adding a new connector

1. Create `packages/connectors/src/sources/<name>.ts` exporting a `ConnectorDef`
2. Register it in `packages/connectors/src/index.ts` (`ALL_CONNECTORS` array)
3. The connector is immediately available at `/connectors` in the UI and via the catalog API

### WebSocket message types

All messages are `ServerToClient` discriminated unions (see `packages/schemas/src/index.ts`):
`event` | `status` | `threatcon` | `pir` | `hello` | `snapshot` | `alert` | `rules` | `drone-track`
