# OverWatch

Real-time situational-awareness platform with a data-fabric ingestion layer, RTSP/OpenCV
camera feeds, a 3D globe map, and on-device WebGPU AI (analyst chat + autonomous Overseer
agent that can drive the app). Inspired by my time with the great peeps at Talon. In-browser
inference for real-time keyword data query, ingestion of OSINT, Government data, open-source
public data feeds, RSS feeds, drone feeds — connectors are ready for whatever you throw at
them at your will. If a connector isn't fitting snug and... well, not connecting, contact me,
or check out the Test-Driven Development agentic workflow implemented; feed that to any agent
as you wish, it'll get you right!  ... .. . 0_o
                                                   . . . hope you enjoy, don't be a stranger . . .
 
> Extended with: pluggable connectors, generic IoT/MQTT/Webhook/RSS
> ingest, 3D globe (Cesium) + 2D MapLibre, browser-side computer-vision detection, and an
> autonomous browser agent powered by `@huggingface/transformers` on WebGPU.

## Quickstart (local dev)

```bash
pnpm install
# In one terminal
pnpm --filter @overwatch/fabric dev
# In another terminal
pnpm --filter @overwatch/web dev
# Optional: seed demo data once fabric is running
pnpm seed
```

Open <http://localhost:3311>.

## Quickstart (Docker)

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build
# then:
pnpm seed
```

## First-run: encryption key and SQLite DB

On the first start of the fabric backend, two files are created automatically inside
`apps/fabric/data/` (the directory is created if it doesn't exist):

| File | What it is | Created by |
|---|---|---|
| `overwatch.db` (+ `-shm`, `-wal`) | SQLite database (events, connectors, cameras, rules, …) | `better-sqlite3` on first connection |
| `key.bin` | 32-byte AES-256-GCM key used to encrypt connector configs at rest, mode `0o600` | `getOrMakeKey()` in `apps/fabric/src/db.ts` |

**These files are intentionally not tracked in git** (see `.gitignore`). Each clone of the
repo generates its own key and its own database — there are no shared secrets in the repo.

You can override the locations with environment variables:

```bash
OVERWATCH_DB=/var/lib/overwatch/overwatch.db
OVERWATCH_KEY_PATH=/var/lib/overwatch/key.bin
```

### Backing up

`overwatch.db` and `key.bin` belong together — back them up as a pair. Losing the key
makes every encrypted connector config (API keys, etc.) unreadable. The `infra/docker-compose.yml`
already persists both onto a single named volume.

### Rotating the encryption key

Connector configs are encrypted with `key.bin`, so rotating the key invalidates any
configs already stored in `overwatch.db`. Two paths:

**Easy (wipes the DB along with the key — fastest, loses local state):**

```bash
# Stop fabric first
rm apps/fabric/data/key.bin
rm apps/fabric/data/overwatch.db apps/fabric/data/overwatch.db-shm apps/fabric/data/overwatch.db-wal
# Restart fabric — a fresh key and DB are generated automatically
pnpm --filter @overwatch/fabric dev
# Repopulate demo data
pnpm seed
```

**Preserve state (keeps connectors and history):** write a one-off migration that reads
each row in `connector_instances`, decrypts `config` with the old key, and re-encrypts
with a new key — then swap `key.bin`. There is no built-in script for this; do it manually
if/when you have production state worth preserving.

## What's inside

```
apps/
  web/      Next.js 15 + React 19 dashboard, 3D globe, analyst, overseer
  fabric/   Fastify + WS hub + connector orchestrator + SQLite + threatcon
packages/
  schemas/  Shared Zod schemas (events, threatcon, PIR, cameras…)
  connectors/  22 connectors (NWS, USGS, EMSC, EONET, OpenAQ, OpenSky, ISS,
               GDELT, HN, Reddit, GitHub, Open-Meteo, CoinGecko, SpaceX,
               NOAA SWPC, Wikipedia RC, NASA FIRMS, MQTT, Webhook, RSS,
               REST poller, Demo simulator)
infra/
  docker-compose.yml + Dockerfiles + go2rtc.yaml
scripts/
  seed-demo.ts
```

## Connectors page

Visit `/connectors` to add/configure/disable any source. API-key sources expose a form
generated from their Zod schema; values are encrypted at rest with AES-256-GCM (per-install
random key in `data/key.bin`).

## Cameras

`Add Camera` on the bottom strip supports:

- `webcam` — local `getUserMedia`
- `hls` / `mjpeg` — direct URL
- `rtsp` — proxied through `go2rtc` (WHEP/WebRTC ≤500 ms)
- `youtube` — embed

Per-camera detectors run in a Web Worker (motion, fire heuristic, edges) and emit `cv` events
back to the fabric.

## AI

- **Analyst**: chat with on-device LLM (SmolLM2 / Qwen2.5 / Llama 3.2) over your live event
  context, automatic WebGPU when available, WASM fallback.
- **Overseer**: autonomous agent that screenshots the page, captions it via `image-to-text`,
  reasons over a DOM outline of `data-agent`-tagged elements, and dispatches whitelisted
  actions (`click`, `flyTo`, `setView`, `toggleNightVision`, `navigate`, `say`, `stop`).
  Press <kbd>Esc</kbd> to abort.

Models are pulled from the Hugging Face CDN on first run and cached in the browser.

## License

MIT (demo). Be a good citizen with public data sources.
