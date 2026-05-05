# Overwatch

Overwatch is a personal-scale **situational awareness console**. It pulls live signals from 22 public data feeds (weather, seismic, air quality, aircraft, news, IoT, space weather, …), correlates them against your own home/work locations, watches RTSP/HLS/webcam video for motion-and-fire-style events, and computes a **THREATCON** score and four **Priority Intelligence Requirements (PIRs)** in real time.

A WebGPU language model rides shotgun in the right rail (the **Analyst**), an autonomous agent (the **Overseer**) can drive the UI, and a configurable **Alert Rules** engine fires desktop notifications and audio alerts when the world does something interesting.

The repository is a [pnpm](https://pnpm.io/) monorepo at `/Users/joshua.giles/Projects/overwatch`, built on **Next.js 15 + React 19** (web) and **Fastify 5 + better-sqlite3** (fabric). 12,112 lines of source split across 44 `.ts` files and 19 `.tsx` files, no test files.

## What's in the box

- **`apps/web`** — Next.js 15 dashboard. Three-panel layout (Intel Feed | Map3D/Map2D | Assessment), a camera strip across the bottom, and pop-out panels for the Analyst (LLM), Overseer (agent), Event Detail, Time Scrubber, Command Palette, and Rules. See [apps/web](../apps/web.md).
- **`apps/fabric`** — Fastify 5 service that owns SQLite, runs all 22 connectors via the [orchestrator](../apps/fabric.md#orchestratorts-connector-lifecycle), computes THREATCON/PIR every 15s, evaluates alert rules, and broadcasts everything over WebSockets. See [apps/fabric](../apps/fabric.md).
- **`packages/schemas`** — Single source of truth: every wire-format object is a Zod schema (events, connectors, locations, cameras, alert rules, WebSocket envelope). See [packages/schemas](../packages/schemas.md).
- **`packages/connectors`** — 22 self-contained connector modules. Each defines a `configSchema`, `defaultConfig`, and an async `run(ctx)` loop. See [packages/connectors](../packages/connectors.md).
- **`infra/`** — `docker-compose.yml` for fabric + web + go2rtc; Dockerfiles; `go2rtc.yaml` for RTSP→WHEP transcoding.
- **`scripts/seed-demo.ts`** — Seeds three home locations, three demo cameras, and 15 connector instances.

The four placeholder workspaces — `packages/agent/`, `packages/ai/`, `packages/cv/`, `packages/ui/` — are empty stubs whose code lives inline in `apps/web/src/lib/` and `apps/web/src/components/`. See [fun-facts](./fun-facts.md).

## Why it exists

The codebase reads like a **playable replica of [overglass.io/demo](https://app.overglass.io/demo)**: the same three-panel intel layout, a 3D Cesium globe, a 2D MapLibre overlay with a heatmap, the camera strip with WHEP/HLS/webcam tiles, and a chat-style analyst. On top of that, `apps/web/src/components/CommandPalette.tsx`, `apps/web/src/components/EventDetail.tsx`, `apps/web/src/components/TimeScrubber.tsx`, and `apps/fabric/src/alerts.ts` add features that sit closer to a real ops console than a marketing demo.

## Where to start

- **I just want to run it locally** → [Getting started](./getting-started.md).
- **I want the 30-second mental model** → [Architecture](./architecture.md).
- **I'm looking up an unfamiliar word** → [Glossary](./glossary.md).
- **I want to add a new data source** → [packages/connectors](../packages/connectors.md) and [how-to-contribute/patterns-and-conventions](../how-to-contribute/patterns-and-conventions.md).
- **I want to know what makes this codebase weird/interesting** → [fun-facts](./fun-facts.md) and [lore](./lore.md).

## Repository map

```
overwatch/
├── apps/
│   ├── fabric/                Fastify backend (1,070 LOC)
│   │   └── src/
│   │       ├── index.ts       REST + WebSocket entry (≈260 LOC)
│   │       ├── db.ts          SQLite + AES-GCM keystore
│   │       ├── orchestrator.ts Connector lifecycle
│   │       ├── threatcon.ts   THREATCON + PIR engine
│   │       └── alerts.ts      Rule engine
│   └── web/                   Next.js 15 dashboard (5,124 LOC)
│       ├── src/app/           Routes: /, /connectors, /rules
│       ├── src/components/    19 .tsx + cvWorker/topicWorker
│       └── src/lib/           store, ws, ai, agent, voice, notify, api
├── packages/
│   ├── schemas/               Zod schemas (179 LOC)
│   ├── connectors/            22 sources (1,527 LOC)
│   ├── agent/  ai/  cv/  ui/  Empty placeholder workspaces
├── infra/                     docker-compose, Dockerfiles, go2rtc.yaml
└── scripts/
    └── seed-demo.ts           Seeds locations, cameras, connectors
```

## Headline features

- 22 connectors, all of them keyless or `freeTier: true`. See [the catalog](../packages/connectors.md#the-catalog).
- Three concurrent map renderers: [Cesium 3D globe](../apps/web.md#map3d-cesium-globe), [MapLibre 2D + heatmap](../apps/web.md#map2d-maplibre-heatmap), and a side-by-side split mode.
- WHEP/HLS/MJPEG/Webcam camera tiles, with a per-tile [computer-vision Web Worker](../features/computer-vision.md) that posts back motion/fire/edge findings as `cv` events.
- WebGPU [analyst](../features/ai-analyst.md) running Hugging Face Transformers.js (Llama-3.2-1B / SmolLM-360M) directly in the browser.
- An [autonomous Overseer agent](../features/overseer-agent.md) that can only click DOM nodes tagged with `data-agent="…"`.
- A complete [alert rules engine](../features/alert-rules.md) with desktop notifications, three sound profiles (chime/siren/tone), per-rule rate limits, and bbox/radius geofencing.
- A [time scrubber](../features/dvr-time-scrubber.md) that re-filters Intel Feed, 2D, and 3D maps to a configurable historical window.
- [Voice mode](../features/voice-mode.md) using whisper-tiny.en for STT and the browser's `speechSynthesis` for TTS.
- [PWA](../features/pwa.md): installable, offline shell, background sync stubs.
