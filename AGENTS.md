# AGENTS.md — OverWatch

This file is the canonical reference for AI coding agents working in the OverWatch repository. It describes the project's architecture, conventions, commands, and workflows. All information here is derived from the actual codebase — do not assume anything not documented in the project files.

---

## Project Overview

OverWatch is a real-time situational-awareness platform. It ingests events from 22+ external data sources (weather, seismic, air traffic, social media, IoT, drone RF, etc.), persists them to an encrypted SQLite database, computes threat levels (THREATCON), evaluates alert rules, and presents everything on a tactical dashboard with a 3D globe (Cesium), 2D map (MapLibre), camera feeds, and on-device AI (analyst chat + autonomous Overseer agent).

The codebase is a **pnpm monorepo** with two applications and six packages. Two packages (`schemas`, `connectors`) hold all current shared code; the other four (`agent`, `ai`, `cv`, `ui`) are scaffolded placeholders — each has a valid `package.json`, `tsconfig.json`, and a `README.md` documenting the planned extraction scope and current source location. They will receive code lifted out of `apps/web` as that work happens.

---

## Technology Stack

| Layer | Technology | Version / Notes |
|---|---|---|
| Package manager | pnpm | `11.2.2` (enforced via `packageManager` field). Native build scripts opt-in via `pnpm-workspace.yaml` `allowBuilds:` (pnpm ≥11) and `onlyBuiltDependencies:` (pnpm 10.x), plus project `.npmrc` `ignore-scripts=false`. |
| Runtime | Node.js | `>=20` |
| Language | TypeScript | `5.9.2`, strict mode, `noUncheckedIndexedAccess` enabled |
| Frontend framework | Next.js | `15.1.3`, App Router, React `19.0.0` |
| Backend framework | Fastify | `5.2.0` with `@fastify/cors` and `@fastify/websocket` |
| State management | Zustand | Client-side global store |
| Database | SQLite | `better-sqlite3` in WAL mode |
| 3D globe | CesiumJS | `1.125.0` |
| 2D maps | MapLibre GL | `4.7.1` |
| Styling | Tailwind CSS | `3.4.17`, dark tactical theme |
| On-device AI | `@huggingface/transformers` | `4.2.0`, WebGPU with WASM fallback |
| Schema validation | Zod | `^3.24.1`, shared across server and client |
| Testing | Vitest | `^4.1.5` (fabric + connectors) |

---

## Monorepo Structure

```
overwatch/
├── apps/
│   ├── fabric/          # Fastify backend (port 4311)
│   └── web/             # Next.js dashboard (port 3311)
├── packages/
│   ├── schemas/         # Shared Zod schemas — ACTIVE
│   ├── connectors/      # 22 data-source connectors — ACTIVE
│   ├── agent/           # Scaffolded — Overseer agent (see packages/agent/README.md)
│   ├── ai/              # Scaffolded — on-device LLM/VLM (see packages/ai/README.md)
│   ├── cv/              # Scaffolded — vision Workers (see packages/cv/README.md)
│   └── ui/              # Scaffolded — shared React components (see packages/ui/README.md)
├── scripts/
│   ├── seed-demo.ts     # Seeds fabric with demo locations, cameras, connectors
│   ├── demo-drone-server.ts  # Simulated drone RF frames for local dev
│   └── smoke-drone.ts   # Automated E2E smoke test for drone pipeline
├── infra/
│   ├── docker-compose.yml
│   ├── Dockerfile.fabric
│   ├── Dockerfile.web
│   └── go2rtc.yaml      # RTSP/WebRTC camera proxy config
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

### Path Mapping

The root `tsconfig.base.json` maps these aliases so packages can import each other directly:

| Alias | Path |
|---|---|
| `@overwatch/schemas` | `packages/schemas/src/index.ts` |
| `@overwatch/connectors` | `packages/connectors/src/index.ts` |
| `@overwatch/ui` | `packages/ui/src/index.ts` |
| `@overwatch/ai` | `packages/ai/src/index.ts` |
| `@overwatch/cv` | `packages/cv/src/index.ts` |
| `@overwatch/agent` | `packages/agent/src/index.ts` |

The web app additionally maps `@/*` → `./src/*` in its own `tsconfig.json`.

---

## Build and Test Commands

All commands should be run from the repository root unless otherwise noted.

### Install dependencies

```bash
pnpm install
```

### Development (run in separate terminals)

```bash
# Terminal 1 — Fabric backend
pnpm --filter @overwatch/fabric dev

# Terminal 2 — Next.js frontend
pnpm --filter @overwatch/web dev
```

The shorthand `pnpm dev` runs both apps in parallel via `pnpm -r --parallel --filter=./apps/* run dev`.

### Seed demo data (fabric must be running)

```bash
pnpm seed
```

This executes `tsx scripts/seed-demo.ts` and posts 3 locations, 3 cameras, and 13 connectors to the Fabric API.

### Type-checking

```bash
# All packages
pnpm typecheck

# Single package
pnpm --filter @overwatch/fabric typecheck
pnpm --filter @overwatch/web typecheck
```

### Linting

```bash
pnpm lint
```

Only `@overwatch/web` has an ESLint config (`apps/web/eslint.config.mjs`). It extends `next/core-web-vitals` and `next/typescript`, with `@typescript-eslint/no-explicit-any` explicitly turned **off** because Transformers.js, Cesium, and MapLibre lack complete type definitions.

### Testing

```bash
# All packages with tests
pnpm test

# Single package
pnpm --filter @overwatch/fabric test
pnpm --filter @overwatch/connectors test

# Single test file
pnpm --filter @overwatch/fabric exec vitest run src/drone.test.ts
```

**Test tooling:** Vitest. `apps/fabric` uses a custom `vitest.config.ts` that forces `OVERWATCH_DB=":memory:"` and a temp key path so tests are isolated and fast. Test files live next to source files (e.g., `src/drone.test.ts`).

### Combined verification (CI equivalent)

```bash
pnpm verify    # shorthand for: pnpm typecheck && pnpm lint
```

### Build for production

```bash
pnpm build     # runs pnpm -r run build
```

---

## Code Style Guidelines

### TypeScript

- **Strict mode is mandatory.** The root `tsconfig.base.json` sets `strict: true` and `noUncheckedIndexedAccess: true`.
- Use ES modules (`"type": "module"` in every package).
- Prefer explicit types for function signatures and public APIs.
- `any` is acceptable only at boundaries with untyped third-party libraries (this is explicitly permitted by the ESLint config for the web app).

### Naming and file structure

- Source files use `.ts` (backend) or `.tsx` (frontend).
- Test files are co-located: `foo.ts` → `foo.test.ts`.
- React components are PascalCase (`DroneDetailPanel.tsx`).
- Utility modules and non-component files are camelCase (`orchestrator.ts`, `useFabricSocket.ts`).

### Import style

- Use workspace aliases (`@overwatch/schemas`, `@overwatch/connectors`) for cross-package imports.
- Use `@/*` for intra-app imports in the web app.
- Do **not** use relative path traversal (`../../`) across package boundaries.

### UI conventions

- The web app uses a dark tactical color palette defined in `tailwind.config.ts`:
  - `ink-950` through `ink-600` for panel backgrounds
  - `accent-500` / `accent-400` for primary actions
  - `threat-*` for severity coloring
  - `nightvision-*` for night-vision mode
- All components that touch browser APIs (WebSocket, Web Workers, Cesium, MapLibre) must be `"use client"`.

---

## Testing Instructions

### Unit tests

Unit tests exist in:

- `apps/fabric/src/*.test.ts` — alerts, database, drone aggregator, orchestrator, threatcon
- `packages/connectors/src/sources/drone-rf.test.ts` — drone RF frame parsing

Run them with Vitest as shown in the Build and Test Commands section.

### Integration / E2E smoke test

`scripts/smoke-drone.ts` is an automated end-to-end test that validates the full drone detection pipeline against a live Fabric server. It:

1. Checks Fabric health
2. Registers a `drone-rf` connector (HTTP poll mode)
3. Waits for a `drone-track` WebSocket message
4. Verifies drone events are persisted in SQLite
5. Verifies the THREATCON PIR contains the drone question
6. Injects an extreme drone event and checks THREATCON score jumps ≥ 2.0
7. Creates an alert rule and verifies it fires

**Prerequisites:** Fabric must be running on `localhost:4311`.

```bash
pnpm tsx scripts/smoke-drone.ts
```

### Manual browser checklist

After running the smoke test (or `demo-drone-server.ts`), verify these visually in the browser at `http://localhost:3311`:

- Cesium globe shows drone billboard and ellipse range ring
- `DroneDetailPanel` renders when `followDroneId` is set in the Zustand store
- Coasting state (solid → dashed trail after 6 s without frames)
- Expiry (billboard removed after 60 s)
- Camera follow locks to track position
- THREATCON score reflects extreme events

---

## Security Considerations

### Connector config encryption

Connector instance configurations (which may contain API keys, passwords, etc.) are encrypted at rest with **AES-256-GCM**. The key is a per-installation random 32-byte file (`key.bin`) generated automatically on first startup.

| File | Purpose | Default location |
|---|---|---|
| `overwatch.db` | SQLite database (events, configs, rules, cameras, …) | `./data/overwatch.db` |
| `key.bin` | AES-256-GCM encryption key (mode `0o600`) | `./data/key.bin` |

**Important:**
- These files are **never committed to git** (see `.gitignore`).
- `overwatch.db` and `key.bin` must be backed up as a pair. Losing the key renders all encrypted connector configs permanently unreadable.
- The Docker Compose stack persists both files onto the named volume `overwatch_data`.

### Environment variables

Copy `.env.example` to `.env` and fill in any optional API keys. The following are the most critical:

| Variable | Default | Purpose |
|---|---|---|
| `FABRIC_PORT` | `4311` | Fabric HTTP / WebSocket port |
| `OVERWATCH_DB` | `./data/overwatch.db` | SQLite database path |
| `OVERWATCH_KEY_PATH` | `./data/key.bin` | Encryption key path |
| `NEXT_PUBLIC_FABRIC_WS` | `ws://localhost:4311` | Browser WebSocket URL |
| `FABRIC_URL` | `http://localhost:4311` | REST API base URL (used by web server) |
| `NEXT_PUBLIC_GO2RTC_URL` | `http://localhost:1984` | go2rtc camera proxy URL |

### Headers for on-device ML

The Next.js app serves `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` headers to enable `SharedArrayBuffer` and WebGPU threading in the browser. Do not remove these headers if the AI features are required.

---

## Runtime Architecture

### Data flow

```
External APIs / MQTT / Webhook / RF nodes
         │
         ▼
┌─────────────────┐    event     ┌──────────────────┐
│  Connectors     │─────────────►│  Orchestrator    │
│  (22 sources)   │              │  (apps/fabric)   │
└─────────────────┘              └────────┬─────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    │                     │                     │
                    ▼                     ▼                     ▼
            ┌──────────┐        ┌─────────────┐       ┌─────────────┐
            │ SQLite   │        │ RuleEngine  │       │ DroneTrack  │
            │ (persist)│        │ (alerts)    │       │ Aggregator  │
            └──────────┘        └──────┬──────┘       └──────┬──────┘
                                       │                     │
                                       └──────────┬──────────┘
                                                  │
                                                  ▼
                                          ┌──────────────┐
                                          │  WebSocket   │
                                          │  broadcast   │
                                          │  (/ws)       │
                                          └──────┬───────┘
                                                 │
                    ┌────────────────────────────┼────────────────────────────┐
                    │                            │                            │
                    ▼                            ▼                            ▼
            ┌──────────┐              ┌─────────────────┐           ┌──────────────┐
            │ Zustand  │              │  Cesium /       │           │  Analyst /   │
            │ store    │              │  MapLibre       │           │  Overseer    │
            │ (events) │              │  (visuals)      │           │  (on-device  │
            └──────────┘              └─────────────────┘           │   AI)        │
                                                                    └──────────────┘
```

### Fabric backend (`apps/fabric`)

| File | Responsibility |
|---|---|
| `src/index.ts` | Fastify server, REST routes, WebSocket `/ws`, broadcast loop |
| `src/db.ts` | SQLite schema, CRUD, AES-256-GCM encrypt/decrypt for connector configs |
| `src/orchestrator.ts` | Connector lifecycle manager (start/stop/add/update/remove) |
| `src/alerts.ts` | `RuleEngine` — evaluates `AlertRule`s against incoming events |
| `src/threatcon.ts` | Computes `ThreatCon` level and `PIR[]` from recent events |
| `src/drone.ts` | `DroneTrackAggregator` — Kalman filter, coasting, swarm correlation |

### Web dashboard (`apps/web`)

| File | Responsibility |
|---|---|
| `src/lib/store.ts` | Zustand global store — all UI state |
| `src/lib/ws.ts` | `useFabricSocket()` — WebSocket client, dispatches to store |
| `src/lib/api.ts` | REST helpers proxied via `/fabric/*` rewrite |
| `src/lib/ai.ts` | On-device LLM via `@huggingface/transformers` |
| `src/lib/agent.ts` | Overseer autonomous agent (screenshot → caption → action) |
| `src/components/Map3D.tsx` | Cesium 3D globe |
| `src/components/Map2D.tsx` | MapLibre 2D map |
| `src/components/DroneTrackLayer.tsx` | Drone track rendering in Cesium |
| `src/components/droneWorker.ts` | Web Worker — drone feature extraction & aggression scoring |
| `src/components/visionWorker.ts` | Web Worker — per-camera CV detection |

---

## Adding a New Connector

1. Create `packages/connectors/src/sources/<name>.ts` exporting a `ConnectorDef` with:
   - `configSchema` (Zod)
   - `defaultConfig`
   - `start(cfg, emit)` factory function
2. Register it in `packages/connectors/src/index.ts` by adding it to the `ALL_CONNECTORS` array.
3. The connector immediately appears in the `/connectors` UI and the catalog REST API.
4. Add unit tests in `packages/connectors/src/sources/<name>.test.ts` if the parsing logic is non-trivial.

---

## Deployment

### Docker Compose (recommended for production-like deploys)

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build
```

Services:
- `fabric` — backend on `:4311`
- `web` — frontend on `:3311`
- `go2rtc` — camera proxy on `:1984` (host networking)

A named volume `overwatch_data` persists `overwatch.db` and `key.bin`.

### Manual deployment

Both apps are plain Node.js processes. Build the web app (`pnpm --filter @overwatch/web build`) and start each service with `pnpm --filter <name> start`. Ensure the environment variables point to the correct URLs and database paths.

---

## Placeholder Packages

The following packages are currently empty stubs (no `package.json`, no source files):

- `packages/agent/` — reserved for future server-side agent/orchestration logic
- `packages/ai/` — reserved for future shared AI/ML model clients
- `packages/cv/` — reserved for future shared computer-vision pipelines
- `packages/ui/` — reserved for a future shared UI component library

Do not implement features inside these packages unless the project's build and path-mapping infrastructure is updated to support them.
