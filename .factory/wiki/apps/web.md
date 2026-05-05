# apps/web — the dashboard

`apps/web/` is a [Next.js 15](https://nextjs.org/) App Router project running on React 19. It is the only frontend.

5,124 lines of source split between routes (`apps/web/src/app/`), components (`apps/web/src/components/`), and the Zustand-centric library layer (`apps/web/src/lib/`). All but a handful of files start with `"use client"` — there is essentially no server work. See `apps/web/package.json` for the full dependency list and [reference/dependencies](../reference/dependencies.md) for the rationale.

## Routes

| Path | File | Purpose |
|---|---|---|
| `/` | `apps/web/src/app/page.tsx` | The main dashboard. Boots the WebSocket, mounts every panel. |
| `/connectors` | `apps/web/src/app/connectors/page.tsx` | CRUD UI for connector instances. |
| `/rules` | `apps/web/src/app/rules/page.tsx` | CRUD UI for [alert rules](../features/alert-rules.md). |
| `/manifest.webmanifest` | `apps/web/public/manifest.webmanifest` | PWA manifest. See [features/pwa](../features/pwa.md). |
| `/sw.js` | `apps/web/public/sw.js` | Service worker for the PWA shell. |

The `/fabric/*` proxy is a **rewrite**, not a route — see `apps/web/next.config.mjs:rewrites()`. Anything under `/fabric/` is forwarded to `FABRIC_URL` (default `http://localhost:4311`), which lets the dashboard talk to fabric on the same origin.

## Top-level layout

```
+--------- TopBar ---------+
| 3D | 2D | Split   FABRIC | THREATCON | Night | Analyst | Overseer | Rules | Connectors |
+--------------------------+----------------------+
| IntelFeed   | MapView (Map3D / Map2D / Split) | AssessmentPanel |
|             | ↑ EventDetail flyout            |                 |
|             | ↑ TimeScrubber overlay          |                 |
|             | ↑ AnalystPanel pop-out          |                 |
|             | ↑ OverseerPanel pop-out         |                 |
+-------------+---------------------------------+-----------------+
| CameraStrip                                                     |
+-----------------------------------------------------------------+
| CommandPalette modal (Cmd+K)                                    |
+-----------------------------------------------------------------+
```

`apps/web/src/app/page.tsx` mounts all of those in roughly that order. The map area is `position: relative` so the four map overlays (`EventDetail`, `TimeScrubber`, `AnalystPanel`, `OverseerPanel`) absolutely-position into it.

## TopBar

`apps/web/src/components/TopBar.tsx`. Contents from left to right:

- Animated radar icon + product name + version badge.
- View switcher: `3D Globe` / `2D Map` / `Split`. Dispatches `setView()`. The buttons all carry `data-agent="view-3d"|"view-2d"|"view-split"` so the Overseer can press them.
- `FABRIC LIVE/OFFLINE` pulse based on `wsConnected`.
- Live source count pulled from `status.filter(s => s.enabled && s.connected).length`.
- THREATCON pill colored by level.
- `Night Vision` toggle — flips a body-level CSS class for green-phosphor look.
- `Analyst` toggle, `Overseer` toggle.
- `Rules` link with a firing badge: when `firings.slice(0,3).length > 0` it goes amber and shows the ruleLabel(s) in the tooltip.
- `Connectors` link.

## IntelFeed

`apps/web/src/components/IntelFeed.tsx` — left rail, 320 px wide, 400-event cap.

- Search input wired to `filter.query`.
- Two pill rows: 12 categories, 5 severities. Clicking toggles set membership in the Zustand `filter`.
- The list is `applyFilter(events, filter, timeWindow)` (see `apps/web/src/lib/store.ts`) — note that the `timeWindow` argument means the Intel Feed automatically respects the [DVR / time scrubber](../features/dvr-time-scrubber.md).
- Each row: severity-colored icon (`EventIcon` maps `ev.icon` to a Lucide glyph, falling back to category), title, summary, relative timestamp, and `geoMentioned` if present.
- Clicking a row calls `select(e.id)` to open `EventDetail`, then `flyTo(...)` if the event has coordinates.

Each row is also tagged `data-agent="event-${e.id}"`. `apps/web/src/lib/agent.ts:collectOutline()` *deliberately filters those out* of the agent's outline (`tag.startsWith("event-")`) because hundreds of dynamic targets would dominate the prompt.

## MapView

`apps/web/src/components/MapView.tsx` is a thin chooser. It uses Next.js `dynamic(...)` with `ssr: false` to lazy-load `Map3D` and `Map2D`, because Cesium and MapLibre touch `window` at import time.

In `view: "split"`, both render side by side and share the same store, so a fly-to fires both maps simultaneously.

### Map3D — Cesium globe

`apps/web/src/components/Map3D.tsx`. Highlights:

- **OSM raster imagery** by default (no Ion token required). If `NEXT_PUBLIC_CESIUM_ION_TOKEN` is set, the Ion default layer is loaded instead.
- The Cesium widget CSS is injected lazily from the official CDN (`https://cesium.com/downloads/cesiumjs/releases/1.125/Build/Cesium/Widgets/widgets.css`). `CESIUM_BASE_URL` is set to the CDN path so workers/assets resolve.
- `contextOptions: { webgl: { preserveDrawingBuffer: true, alpha: true } }` — required so the [Overseer](../features/overseer-agent.md) can call `canvas.toBlob()` for vision captures.
- `viewer.scene.canvas.dataset.agent = "map-3d-canvas"` so the canvas itself is in the agent allowlist.
- Entity sync runs on every change to `visibleEvents` / `locations` / `aircraftTrails`. It diffs an in-memory `Map<id, entity>` cache and adds/removes/updates by ID, so re-renders don't recreate every dot.
- **Aircraft trails**: events with `payload.icao24` are bucketed by ICAO24, sorted by `occurredAt`, and the last 12 positions become a `polyline` in accent green. Capped at 30 trails to bound work.
- **Locations** render as semi-transparent green ellipses with a label; the radius comes from `loc.radiusKm * 1000`.
- Clicks: `ScreenSpaceEventHandler.LEFT_CLICK` → `viewer.scene.pick()` → `select(picked.id.id)`.
- Camera flies on `flyTo` requests (then resets it to `null`) and on `followEntity` when the kind is `icao24`.

### Map2D — MapLibre + heatmap

`apps/web/src/components/Map2D.tsx`. Highlights:

- OSM raster basemap, dimmed (`raster-opacity: 0.5`, `raster-saturation: -0.4`).
- Two layers on the same `events` GeoJSON source:
  - `events-heat` — a `heatmap` layer with weight derived from severity (`extreme=1, high=0.8, moderate=0.5, low=0.25`). Visible only at `zoom < 9`.
  - `events-circle` — colored circles from zoom 4 up.
- Click handler on `events-circle` → `useStore.getState().selectEvent(...)`.
- A second `locations` layer renders saved Location centroids as accent rings.
- `preserveDrawingBuffer: true` for the same screenshot reason as Cesium.

## AssessmentPanel — right rail

`apps/web/src/components/AssessmentPanel.tsx`, 320 px. Four cards stacked top-to-bottom:

1. **THREATCON** — large numeric score colored by level, gauge bar to 10, top reasons. See [features/threatcon-pir](../features/threatcon-pir.md).
2. **Priority Intelligence** — the 6 PIRs from the fabric. Color-coded yes/no/unknown badge per question.
3. **Source Health** — list of all connector instances with a pulse dot for connected, label, and `eventsLastMinute`.
4. **Severity mix** — segmented bar showing relative counts of extreme/high/moderate/low/info events in the current event array.

## CameraStrip & CameraTile

`apps/web/src/components/CameraStrip.tsx` along the bottom, 128 px tall. Loads cameras from `GET /api/cameras` once on mount, then renders a fixed "Add Camera" tile + one `CameraTile` per camera.

`apps/web/src/components/CameraTile.tsx` is the per-camera renderer:

- **`webcam`** — `navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 } })`.
- **`mjpeg`** — direct `video.src = camera.source`.
- **`hls`** — Safari-native first; otherwise dynamic `import("hls.js")` with `liveSyncDurationCount: 2, lowLatencyMode: true`.
- **`rtsp`** — WHEP via go2rtc. `playWhep()` does an SDP offer → `POST {whepUrl}` → answer round-trip; the function returns the `RTCPeerConnection` so the cleanup `useEffect` can close it.
- **`youtube`** — an iframe with the `embed/` URL form.

The status pill in the top-left of each tile shows `connecting | live | offline`, reflecting `playing` / `error` / `stalled` events on the `<video>`. Hover reveals a theatre-mode button (`Maximize2`) and a delete button.

A second `useEffect` on each tile spawns the `cvWorker.ts` Web Worker if `camera.detectors` is non-empty. Every ~1 s, a 160×90 ImageData is sampled from the video and posted to the worker; on `detection`, the tile increments a counter and POSTs `/fabric/api/cv-event`.

See [features/computer-vision](../features/computer-vision.md) for the worker's algorithms.

## AnalystPanel

`apps/web/src/components/AnalystPanel.tsx`. Right-side pop-out, 420 px wide. State machine:

- Model picker: SmolLM2-360M, SmolLM2-1.7B, Qwen2.5-0.5B, Llama-3.2-1B.
- TTS toggle.
- A live `device` badge (`webgpu` / `wasm`) updated by `runChat`'s `onDevice` callback.
- A scrollable transcript — only `role: user | assistant` are rendered.
- Below, a mic button (`toggleVoice` from `apps/web/src/lib/voice.ts`), an input, and a send/stop button.
- Quick-prompt buttons: "Generate briefing" + four canned suggestions.

The panel listens for a custom `overwatch:analyst-prompt` window event so that `EventDetail`'s "Ask analyst" button can pre-populate the input remotely:

```ts
window.dispatchEvent(new CustomEvent("overwatch:analyst-prompt", { detail: "Brief me on …" }));
```

`runBriefing()` is a separate code path: it fetches `GET /api/briefing-context` from the fabric and asks for a structured 5-section markdown briefing. See [features/briefing-generator](../features/briefing-generator.md).

## OverseerPanel

`apps/web/src/components/OverseerPanel.tsx`. Right-side pop-out, 420 px. Mirror of the analyst panel but for actions instead of chat:

- Mission textarea + 4 preset missions.
- Step budget input (1–20).
- Start / Pause / Stop buttons.
- A scrollable step transcript with each step's thought, action, vision caption, and result.

When started, `await import("@/lib/agent")` and call `runOverseer({...})`. See [features/overseer-agent](../features/overseer-agent.md) for what the agent can actually do.

## EventDetail flyout

`apps/web/src/components/EventDetail.tsx`. Renders only when `selectedEventId` is non-null. 360 px wide, anchored top-right inside the map area.

Computes a `related` list using a small scoring function (same connector +1, same category +1, geographic distance < 100 km +2, same `payload.icao24` +5) and shows the top 6.

Buttons:
- `source` — opens `ev.url` in a new tab.
- `Ask analyst` — opens the analyst and dispatches the custom event above.
- `Follow aircraft` — only when `payload.icao24` is set; sets the `followEntity` store key, which `Map3D` reads to lock the camera onto subsequent positions.

## TimeScrubber (DVR)

`apps/web/src/components/TimeScrubber.tsx`. A small floating bar centred at the bottom of the map area. See [features/dvr-time-scrubber](../features/dvr-time-scrubber.md).

## CommandPalette

`apps/web/src/components/CommandPalette.tsx`. Cmd+K (or Ctrl+K) toggles a modal with:
- View switches, Night Vision toggle, panel toggles.
- Navigate to `/rules`, `/connectors`.
- DVR live / replay last hour.
- Fly to top severity-ranked event.
- Filter shortcuts ("only high+extreme", "clear filters").

Substring-filter on labels; Enter runs the first match. See [features/command-palette](../features/command-palette.md).

## CSS / theming

`apps/web/src/app/globals.css` (81 lines) plus `apps/web/tailwind.config.ts` define the design system:

- `accent-{50…900}` for the green tactical accent.
- `ink-{50…950}` for the cool-grey backgrounds.
- `threat-{nominal|guarded|elevated|high|critical}` for THREATCON levels and severities.
- `nightvision` color and a `.nightvision` body class that re-tints the entire UI.
- `tactical-grid` background utility (subtle CRT-style horizontal lines), `pulse-dot` keyframe.
- Custom `.panel` / `.btn` / `.input` / `.scrollable` / `.badge` utility classes used everywhere instead of inline Tailwind soup.

## Library layer (`apps/web/src/lib/`)

| File | Role |
|---|---|
| `store.ts` | Zustand store: events, status, locations, cameras, threatcon, pirs, view, filters, selectedEventId, flyTo, rules, firings, **timeWindow**, **followEntity**, plus the `applyFilter()` helper. |
| `ws.ts` | `useFabricSocket()` — connects to `NEXT_PUBLIC_FABRIC_WS`, dispatches `event/snapshot/status/threatcon/pir/rules/alert` envelopes into the store. Auto-reconnects with exponential backoff capped at 15 s. Plays sounds + desktop notifications on alerts. |
| `ai.ts` | `runChat()`, `getOrCreatePipeline()`, `detectDevice()`, `runVisionCaption()` — wraps `@huggingface/transformers`. Caches pipelines per `(task, model, device, dtype)`. WebGPU first, WASM fallback. Installs a `console.error` filter to silence ORT noise. |
| `agent.ts` | `runOverseer({...})` — the planning loop for the [Overseer](../features/overseer-agent.md). |
| `voice.ts` | `startRecording()`, `speak()`, `cancelSpeak()` — Whisper-tiny.en STT (transformers.js) + browser `speechSynthesis` TTS. See [features/voice-mode](../features/voice-mode.md). |
| `notify.ts` | `playSound()` (chime/siren/tone via WebAudio), `showDesktopNotification()`. |
| `api.ts` | `apiGet`/`apiPost`/`apiPatch`/`apiDelete` against the `/fabric/*` proxy. |
| `cn.ts` | `clsx + tailwind-merge` helper. |

## Web Workers

| File | Role |
|---|---|
| `apps/web/src/components/cvWorker.ts` | Per-camera detector loop. See [features/computer-vision](../features/computer-vision.md). |
| `apps/web/src/components/topicWorker.ts` | Zero-shot topic classifier (`Xenova/nli-deberta-v3-xsmall`). |

## Boot sequence (a typical session)

1. User opens `http://localhost:3311`.
2. `apps/web/src/app/layout.tsx` mounts `PwaRegister` (registers `/sw.js`) and renders `page.tsx`.
3. `page.tsx` calls `useFabricSocket()` and `apiGet("/api/locations")`. The WebSocket connects.
4. The fabric pushes `hello`, `snapshot` (200 events), `status`, `rules`, `threatcon`, `pir` envelopes in quick succession.
5. The store fills, all components re-render with real data.
6. The user clicks "Analyst", which lazy-loads `@huggingface/transformers` from CDN. First model download progresses to 100%, then the chat is interactive.
7. The user clicks `Cmd+K` → "Switch to 2D map" → `setView("map2d")`. `MapView` swaps the dynamic import; Cesium is unmounted, MapLibre takes over.
8. A new `extreme` weather event matches a configured Alert Rule. The fabric pushes `{type:"alert"}`. `ws.ts` calls `notifyAlert()`. The user hears a chime and sees a system notification.
9. They click the firings count in the TopBar → navigate to `/rules`.
