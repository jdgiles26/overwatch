# Getting started

You need:

- **Node 22+** (the Dockerfiles use `node:22-bookworm-slim`).
- **pnpm 10.33.2+** (`corepack enable && corepack prepare pnpm@10.33.2 --activate`).
- A modern browser. Chrome/Edge are best — WebGPU isn't needed but everything is faster with it.
- *(Optional)* Docker for the all-in-one `infra/docker-compose.yml`.
- *(Optional)* `go2rtc` if you want RTSP cameras. The `infra/docker-compose.yml` boots one for you.
- *(Optional)* `ffmpeg` is installed via go2rtc; only relevant if you transcode locally.

## Local dev (two-terminal)

```bash
pnpm install
# terminal 1
pnpm --filter @overwatch/fabric dev
# terminal 2
pnpm --filter @overwatch/web dev
# once fabric is up, seed demo data (15 connectors, 3 cameras, 3 locations)
pnpm seed
```

Then open <http://localhost:3311>.

The first time you load the page:

1. The WebSocket connects to `ws://localhost:4311/ws` and you'll see `connected` light up in the [`TopBar`](../apps/web.md#topbar).
2. The fabric snapshot pushes the most recent 200 events; THREATCON appears in the right rail within ~15s.
3. The Analyst panel shows "tap to load model" — first click will pull a transformers.js model (Llama-3.2-1B-Instruct quantised q4 / SmolLM2-360M-Instruct q8) from the Hugging Face CDN. Subsequent loads are cached.

## Docker

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build
# in a separate shell, after fabric is healthy:
pnpm seed
```

This boots three containers (`fabric` on `:4311`, `web` on `:3311`, `go2rtc` on `:1984`/`:8555`). `go2rtc` is run in `network_mode: host` so WebRTC ICE candidates (`host:8555`) work on macOS without special routing.

## Environment variables

See `.env.example`. The defaults work out of the box; everything below is optional.

| Var | Used by | Effect |
|---|---|---|
| `OPENAQ_API_KEY` | `connectors/openaq` | unlocks higher-rate air-quality endpoints |
| `OPENSKY_USERNAME` / `OPENSKY_PASSWORD` | `connectors/opensky` | doubles the rate limit and adds extended ICAO24 vectors |
| `NASA_FIRMS_MAP_KEY` | `connectors/nasa-firms` | required to fetch FIRMS active fire pixels |
| `GITHUB_TOKEN` | `connectors/github-events` | bumps the rate limit from 60/hr to 5000/hr |
| `NEXT_PUBLIC_CESIUM_ION_TOKEN` | `apps/web/Map3D` | upgrades the basemap to the Cesium Ion world imagery |
| `NEXT_PUBLIC_GO2RTC_URL` | `apps/web/CameraTile` (RTSP→WHEP) | defaults to `http://localhost:1984` |
| `NEXT_PUBLIC_FABRIC_WS` | `apps/web/lib/ws.ts` | defaults to `ws://localhost:4311` |
| `FABRIC_URL` | Next.js rewrite | the URL the dashboard proxies `/fabric/*` to |
| `FABRIC_PORT` | `apps/fabric/src/index.ts` | listen port (default `4311`) |
| `OVERWATCH_DB` | `apps/fabric/src/db.ts` | SQLite file path |
| `OVERWATCH_KEY_PATH` | `apps/fabric/src/db.ts` | AES-256-GCM keystore path |

## First-run checklist

After `pnpm seed`, you should see:

- [`/connectors`](http://localhost:3311/connectors) — 15 instances, most green ("connected").
- The Intel Feed in the left rail filling with weather alerts, earthquakes, ISS pings, and Hacker News stories.
- THREATCON in the right rail computed from your three seeded locations (`DC HQ`, `SF Office`, `Tokyo Lab`).
- The bottom camera strip with `Demo: Big Buck Bunny`, `EarthCam Times Sq`, and `Demo RTSP (go2rtc)` tiles. The RTSP one only works if `go2rtc` is reachable on `:1984`.
- Cmd-K opens the [Command Palette](../features/command-palette.md).

## Common first-run failures

- **`pnpm seed` returns 404 on `/api/connectors`** — the fabric isn't running yet, or `FABRIC_URL` doesn't match. Check `pnpm --filter @overwatch/fabric dev`'s log.
- **The 3D globe is blank** — Cesium needs `CESIUM_BASE_URL`/Ion tokens for high-quality imagery. The wiki page [apps/web § Map3D](../apps/web.md#map3d-cesium-globe) covers fallback behaviour.
- **WebGPU "not available" warning in the analyst** — you're either on Safari (no WebGPU yet on stable as of writing) or your GPU isn't on the allowlist. Click *Use WASM* and you'll get the same model on CPU at ~1/3 the throughput.
- **RTSP camera tile shows `WHEP 404`** — go2rtc isn't running, or the stream name doesn't exist in `infra/go2rtc.yaml`.
- **`better-sqlite3` rebuild errors on macOS arm64** — make sure you're on Node 22 and that Xcode CLT is installed (`xcode-select --install`).

## Useful URLs once it's running

- <http://localhost:3311> — main dashboard
- <http://localhost:3311/connectors> — connector CRUD
- <http://localhost:3311/rules> — alert rules CRUD
- <http://localhost:4311/health> — fabric liveness
- <http://localhost:4311/api/connectors/catalog> — full connector catalog (definitions + Zod fields)
- <http://localhost:4311/api/events?limit=200> — last 200 ingested events as JSON
- <http://localhost:4311/api/threatcon> — current THREATCON + PIRs as JSON
- <http://localhost:4311/api/firings?limit=50> — recent rule firings
- <http://localhost:4311/ws> — the WebSocket endpoint (use a client like `websocat`)
