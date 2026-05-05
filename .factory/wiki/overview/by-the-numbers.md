# By the numbers

A precise inventory of the repo as it stood at commit `bc1d1ee` (`Initial commit`, 2026-04-30, JDG-Tyto). All counts come from the commit's working tree. No emojis, no rendered charts — just the numbers a maintainer needs.

## Source size

| Language | Lines | Notes |
|---|---|---|
| TypeScript (`.ts`) | 4,181 | All app + connector + schema source |
| TSX (`.tsx`) | 3,753 | All React components and routes |
| CSS | 81 | `apps/web/src/app/globals.css` only |
| YAML | 8,659 | Almost entirely `pnpm-lock.yaml` |
| JSON | 230 | `package.json` × 5 + `tsconfig*.json` |
| **Total source** | **12,112** | TS + TSX + CSS |

The pnpm-lock dominates the YAML count by ~99% — `infra/go2rtc.yaml` and `infra/docker-compose.yml` together are under 80 lines.

## File counts

| Type | Count |
|---|---|
| `.ts` files | 44 |
| `.tsx` files | 19 |
| Test files (`*.test.*`, `*.spec.*`) | 0 |
| `TODO` / `FIXME` comments | 0 |

## Per-directory line counts

| Directory | Lines |
|---|---|
| `apps/web` | 5,124 |
| `apps/fabric` | 1,070 |
| `packages/connectors` | 1,527 |
| `packages/schemas` | 179 |
| `scripts/` | 115 |
| `infra/` | 52 |

The four placeholder workspaces — `packages/agent`, `packages/ai`, `packages/cv`, `packages/ui` — each have an empty `src/` directory and contribute zero lines of source. See [overview/lore](./lore.md).

## apps/fabric breakdown

| File | LOC | Role |
|---|---|---|
| `apps/fabric/src/index.ts` | ~260 | Fastify routes, WebSocket, broadcast, threat loop. |
| `apps/fabric/src/db.ts` | ~260 | better-sqlite3 + AES-256-GCM keystore. |
| `apps/fabric/src/orchestrator.ts` | ~170 | Connector lifecycle (start/stop/update). |
| `apps/fabric/src/threatcon.ts` | ~110 | THREATCON + PIR algorithms. |
| `apps/fabric/src/alerts.ts` | ~100 | RuleEngine. |

## apps/web breakdown

19 `.tsx` components plus 7 `.ts` library files plus 3 routes.

| Component / file | Role |
|---|---|
| `apps/web/src/app/page.tsx` | Dashboard root. |
| `apps/web/src/app/connectors/page.tsx` | Connectors CRUD. |
| `apps/web/src/app/rules/page.tsx` | Alert rules CRUD. |
| `apps/web/src/components/TopBar.tsx` | Top chrome. |
| `apps/web/src/components/IntelFeed.tsx` | Left rail. |
| `apps/web/src/components/MapView.tsx` | Map chooser. |
| `apps/web/src/components/Map3D.tsx` | Cesium 3D globe. |
| `apps/web/src/components/Map2D.tsx` | MapLibre 2D + heatmap. |
| `apps/web/src/components/AssessmentPanel.tsx` | Right rail. |
| `apps/web/src/components/CameraStrip.tsx` | Bottom strip container. |
| `apps/web/src/components/CameraTile.tsx` | Per-camera renderer. |
| `apps/web/src/components/AnalystPanel.tsx` | LLM chat panel. |
| `apps/web/src/components/OverseerPanel.tsx` | Agent panel. |
| `apps/web/src/components/EventDetail.tsx` | Event flyout. |
| `apps/web/src/components/TimeScrubber.tsx` | DVR control. |
| `apps/web/src/components/CommandPalette.tsx` | Cmd+K modal. |
| `apps/web/src/components/PwaRegister.tsx` | Service-worker registrar. |
| `apps/web/src/components/ConsoleFilter.tsx` | ORT noise filter. |
| `apps/web/src/components/cvWorker.ts` | Per-tile CV Web Worker. |
| `apps/web/src/components/topicWorker.ts` | Zero-shot topic worker. |
| `apps/web/src/lib/store.ts` | Zustand store + `applyFilter`. |
| `apps/web/src/lib/ws.ts` | WebSocket bridge. |
| `apps/web/src/lib/ai.ts` | Transformers.js wrapper. |
| `apps/web/src/lib/agent.ts` | Overseer planner. |
| `apps/web/src/lib/voice.ts` | Whisper STT + TTS. |
| `apps/web/src/lib/notify.ts` | WebAudio + desktop notifications. |
| `apps/web/src/lib/api.ts` | `apiGet/Post/Patch/Delete`. |
| `apps/web/src/lib/cn.ts` | `clsx + tailwind-merge` helper. |

## Connectors

22 connectors under `packages/connectors/src/sources/*.ts`. Full table in [packages/connectors](../packages/connectors.md). Quick split:

- 16 polling connectors.
- 1 streaming SSE connector (`wikipedia-rc`).
- 1 MQTT subscriber (`mqtt-generic`).
- 1 webhook receiver (`webhook`).
- 1 demo simulator (`simulator`).
- 2 generic shells (`rest-generic`, `rss`).

## Database tables

7 tables, all created with `IF NOT EXISTS` in `apps/fabric/src/db.ts`:

| Table | Purpose |
|---|---|
| `events` | Every `IngestEvent`. |
| `connector_instances` | Connector lifecycle rows; `config` is AES-encrypted. |
| `cameras` | Camera feed metadata. |
| `locations` | User-saved Locations. |
| `alert_rules` | Rule definitions; `notify` and `condition` JSON-encoded. |
| `alert_firings` | Persisted firings; full event JSON in `payload`. |
| `aois` | Polygon Areas of Interest. |

## Domain enumerations

| Enum | Members |
|---|---|
| `EventCategory` | 16: `weather, seismic, air, transport, power, water, news, iot, cv, space, finance, social, fire, lightning, health, other` |
| `Severity` | 5: `info, low, moderate, high, extreme` |
| `ConnectorAuthKind` | 6: `none, api-key, oauth, mqtt, webhook, rtsp` |
| `Location.kind` | 5: `home, work, school, family, other` |
| `CameraFeed.kind` | 5: `rtsp, hls, mjpeg, webcam, youtube` |
| `Detector` | 5: `motion, person, vehicle, fire, plate` |
| `ThreatCon.level` | 5: `nominal, guarded, elevated, high, critical` |
| `AlertRule.notify.soundKind` | 4: `chime, siren, tone, none` |
| Sound profiles | 3 audible: `chime` (3 sine notes), `siren` (sawtooth sweep), `tone` (single triangle) |

## PIRs

Six fixed PIRs in `apps/fabric/src/threatcon.ts`:

1. `weather-25km` — 24 h window, 40 km radius.
2. `quake-200km` — 24 h window, 200 km radius, M ≥ 4.
3. `fire-nearby` — 24 h window, 100 km radius.
4. `aqi-poor` — 24 h window, 30 km radius.
5. `iot-breach` — 1 h window, no geo.
6. `cv-alert` — 1 h window, no geo.

## THREATCON formula constants

| Constant | Value |
|---|---|
| Recency cutoff | 6 hours (by `receivedAt`) |
| Proximity weight | `severity * 0.7` (only for severity ≥ moderate) |
| Global extreme boost | `+1` per event |
| Global high boost | `+0.3` per event |
| Score saturation | `min(10, score)` |
| Reasons cap | top 6 |
| Level breakpoints | `≥8 critical, ≥6 high, ≥4 elevated, ≥2 guarded, else nominal` |
| Broadcast cadence | every 15 seconds |

## CV worker constants

| Constant | Value |
|---|---|
| Sample resolution | 160 × 90 ImageData |
| Sample cadence | ~1 Hz |
| Cooldown per detector | 6 seconds |
| Motion threshold | sum-of-RGB-delta > 80, score > 0.04 |
| Fire threshold | `R > 180 ∧ G < 140 ∧ B < 90 ∧ R - B > 80`, score > 0.05 |
| Edge threshold | `\|lum − lumRight\|` > 90, score > 0.2 |

## Repo / commit metadata

| Metric | Value |
|---|---|
| Commits | 1 (`bc1d1ee`, "Initial commit", 2026-04-30) |
| Contributors | 1 (`JDG-Tyto`) |
| Branches | `main` only (no remote pushes) |
| Issues / PRs / discussions | 0 (single-commit repo) |
| `pnpm-lock.yaml` | committed (~117 KB) |
| `apps/fabric/data/overwatch.db` | committed (~2 MB SQLite snapshot) |
| `apps/fabric/data/key.bin` | committed (encryption key) |

The committed `data/` files are why a fresh clone has a populated state. See [overview/fun-facts](./fun-facts.md).

## Frontend dependencies (top-level)

From `apps/web/package.json`:

- `next@15`, `react@19`, `react-dom@19`
- `zustand` (state)
- `@huggingface/transformers` (LLM + vision + STT)
- `cesium` (3D globe)
- `maplibre-gl` (2D + heatmap)
- `hls.js` (camera tiles)
- `lucide-react` (icons)
- `tailwindcss` + `clsx` + `tailwind-merge`
- `html-to-image` (Overseer fallback screenshot)
- `zod` (re-exported from `packages/schemas`)

## Backend dependencies

From `apps/fabric/package.json`:

- `fastify@5`, `@fastify/cors`, `@fastify/websocket`
- `better-sqlite3` (synchronous SQLite)
- `mqtt` (for `mqtt-generic`)
- `xml2js` (RSS connector)
- `zod` (re-exported from `packages/schemas`)
- `tsx` (dev runner)

## Missing on purpose

- **0 test files.** No Jest, Vitest, Playwright, or any test runner. See [overview/lore](./lore.md).
- **0 TODO/FIXME comments.** `rg "TODO|FIXME"` returns nothing.
- **0 environment variable samples beyond the four in `.env.example`** (`OPENAQ_API_KEY`, `GITHUB_TOKEN`, `NASA_FIRMS_MAP_KEY`, `NEXT_PUBLIC_CESIUM_ION_TOKEN`).
- **0 lint config files** beyond Next.js's `next/core-web-vitals` default.
- **0 GitHub Actions workflows** under `.github/` (the directory does not exist).

## Related pages

- [overview/index](./index.md) — narrative overview.
- [overview/architecture](./architecture.md) — process and data-flow diagrams.
- [overview/lore](./lore.md) — context for the "single sitting" build.
- [overview/fun-facts](./fun-facts.md) — quirks the maintainer should know.
