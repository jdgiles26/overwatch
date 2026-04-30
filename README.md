# OverWatch

Real-time situational-awareness platform with a data-fabric ingestion fabric, RTSP/OpenCV
camera feeds, a 3D globe map, and on-device WebGPU AI (analyst chat + autonomous Overseer
agent that can drive the app).

> Inspired by `overglass.io` — extended with: pluggable connectors, generic IoT/MQTT/Webhook/RSS
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
