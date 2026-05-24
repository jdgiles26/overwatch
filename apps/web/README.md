# `apps/web` — Next.js dashboard

Next.js 15 App Router + React 19 + Tailwind. Dark tactical theme. Runs
on `:3311`. Connects to fabric over WS and renders a 3D globe (Cesium),
2D map (MapLibre), camera strip with per-tile AI detection, intel feed,
THREATCON/PIR panel, drone tracks, analyst chat, and the Overseer
autonomous agent.

**Run**: `pnpm --filter @overwatch/web dev`
**Test**: `pnpm --filter @overwatch/web test`
**Lint**: `pnpm --filter @overwatch/web lint`
**URL**: `http://localhost:3311`

---

## Layout

```
src/
├── app/                 Next.js App Router
│   ├── layout.tsx        Global shell, font, theme
│   ├── page.tsx          Main dashboard surface
│   ├── connectors/       Connector manager page (CRUD on /api/connectors/*)
│   └── rules/            Alert-rule editor page
├── components/          React components (see docs/FEATURES.md for full map)
└── lib/                 Hooks, store, model wrappers, browser-side engines
```

---

## State & data

| File | Concern |
|---|---|
| `lib/store.ts` | **Single Zustand store.** All UI state lives here — view mode, filters, threat-con, events, cameras, drone tracks, detection modes, model statuses. Components subscribe via `useStore`. |
| `lib/ws.ts` | `useFabricSocket()` hook — connects to fabric, dispatches `ServerToClient` messages into the store, handles reconnect. |
| `lib/api.ts` | Thin `fetch` wrappers around fabric REST routes. |

The store is the single source of truth; never duplicate WS-driven
state in component-local React state.

---

## AI surfaces

| File | Concern |
|---|---|
| `lib/ai.ts` | On-device LLM via `@huggingface/transformers` (WebGPU → WASM fallback). Backs the Analyst chat panel. |
| `lib/agent.ts` | **Overseer** autonomous agent: screenshot → `image-to-text` caption → reason over a DOM outline of `data-agent`-tagged elements → dispatch a whitelisted action. <kbd>Esc</kbd> aborts. |
| `lib/voice.ts` | Web Speech API wrapper (TTS + STT) for the Analyst panel. |
| `lib/notify.ts` | Browser notifications for alerts. |

Models pulled from the Hugging Face CDN on first run and cached in the
browser. See `docs/FEATURES.md` for the model registry.

---

## Vision pipeline (browser-side CV)

| File | Concern |
|---|---|
| `components/visionWorker.ts` | Web Worker hosting the VLM (LFM2-VL-450M-ONNX) for per-frame scene captioning. 3-tier backend chain: WebGPU → WebGL (TF.js MobileNet) → WASM. |
| `components/droneDetectorWorker.ts` | Web Worker hosting the object-detector (DETR-ResNet-50) for drone-like detections. 3-tier chain: WebGPU → WebGL (TF.js coco-ssd) → WASM. |
| `lib/visionEngine.ts` | Shared frame submission + detection event bus for `visionWorker`. Handles `status:"fallback"` → `pushError`. |
| `lib/droneDetectorEngine.ts` + `droneDetectorWorkerEngine.ts` | Same, for the YOLO-style detector. |
| `lib/detectionConfig.ts` | `DetectionMode` enum (`off`/`yolo`/`vlm`/`both`) + parser + canonical model IDs. |
| `lib/backendSelector.ts` | `selectDetectorBackend` priority chain + capability detection. |
| `lib/cocoSsdAdapter.ts`, `lib/mobilenetVlmAdapter.ts` | Adapters that normalize TF.js model outputs into our `DetectorRawOutput` shape. |
| `lib/frameCapture.ts` | OffscreenCanvas singleton with DOM-canvas fallback for ImageData extraction. |
| `lib/boundingBox.ts` + `components/BoundingBoxOverlay.tsx` | Box normalization, severity colors, SVG overlay with glow. |

Detections POST back to fabric at `/api/cv-event` (handled in
`apps/fabric/src/index.ts`).

### Cesium assets
Cesium ships with a `Build/Cesium/` directory of Workers, Assets,
Widgets, and ThirdParty libs. `cesium.com`'s CDN has no
`Access-Control-Allow-Origin`, so the browser blocks loading from there.
We mirror those assets into `public/cesium/` at `predev` / `prebuild`
time via `scripts/copy-cesium-assets.mjs` and Map3D sets
`window.CESIUM_BASE_URL = "/cesium/"`. Force-refresh with
`pnpm --filter @overwatch/web cesium:assets`.

---

## Drone RF (browser-side ingest)

| File | Concern |
|---|---|
| `components/droneWorker.ts` | RF signal processing + heuristic threat classification. |
| `lib/useDroneWorker.ts` | React hook lifecycle for the drone Worker. |
| `components/DroneTrackLayer.tsx`, `DroneDetailPanel.tsx` | Map overlay + detail panel for tracks. |

Drone frames feed in over the WS `drone-rf` message and produce
`drone-track` / `drone-classification` events.

---

## Component conventions

- Components live in `src/components/`. `docs/FEATURES.md` is the
  canonical mapping of component → `data-agent` ID → test.
- `data-agent="..."` attributes mark elements the Overseer can target.
  Adding a new interactive control means adding a `data-agent` ID and
  updating `docs/FEATURES.md`.
- Tailwind classes go on JSX. Use `clsx` + `tailwind-merge` via
  `lib/cn.ts` for conditional class composition.
- Lucide icons for chrome; SVG-from-figma for tactical glyphs.

---

## Notes for agents

- The store is global; before adding a new piece of state, check if an
  existing field covers it. Don't introduce React context for what the
  store can hold.
- Web Workers are loaded via `new Worker(new URL(..., import.meta.url))`
  — Next.js native syntax. Worker files must stay self-contained
  (no `window`, no DOM).
- `vitest.config.ts` runs in `node` environment with `@overwatch/schemas`
  aliased to source — keep new tests pure-logic (don't try to render
  React inside vitest without adding a jsdom environment first).
- Bundle size matters: Cesium and `@huggingface/transformers` are
  multi-MB. Audit any new dependency.
