# OverWatch — Feature Reference

This document is the canonical, machine-verifiable inventory of every user-facing
capability in OverWatch. Each row maps a feature to its source file(s),
`data-agent` identifier (where applicable), and the tests that protect it.

The doc is grouped into:

1. UI surfaces (panels, toggles, buttons)
2. Map and globe views
3. Intel feed and event lifecycle
4. Camera + computer-vision pipeline (YOLO/VLM)
5. AI assistants (Analyst, Overseer)
6. Connector catalog
7. Real-time data flow (fabric ↔ web)
8. AI model registry

Anything not listed here is either (a) experimental and gated behind an internal
flag, or (b) needs to be added to this document before merging.

---

## 1. UI Surfaces

| Feature | Source | data-agent | Tested by |
|---|---|---|---|
| Top bar (status, view switcher, agent buttons) | `apps/web/src/components/TopBar.tsx` | `topbar-*` | Manual smoke |
| Analyst chat panel | `apps/web/src/components/AnalystPanel.tsx` | `analyst`, `analyst-input`, `analyst-send`, `analyst-mic`, `analyst-tts`, `analyst-briefing` | `apps/web/src/lib/ai.test.ts` (anti-loop), manual |
| Overseer autonomous agent panel | `apps/web/src/components/OverseerPanel.tsx` | `overseer`, `overseer-start`, `overseer-mission` | `apps/web/src/lib/agent.test.ts` |
| Command palette | `apps/web/src/components/CommandPalette.tsx` | — | Manual |
| Intel feed | `apps/web/src/components/IntelFeed.tsx` | `event-<id>` | Manual |
| Event detail drawer | `apps/web/src/components/EventDetail.tsx` | `event-detail` | Manual |
| Threat/PIR assessment panel | `apps/web/src/components/AssessmentPanel.tsx` | `assessment` | `apps/fabric/src/threatcon.test.ts` |
| Per-PIR click-to-expand + "Show on map" CTA | `apps/web/src/components/AssessmentPanel.tsx`, `apps/web/src/lib/pirDetail.ts` | `pir-<id>`, `pir-<id>-toggle`, `pir-<id>-show-on-map`, `pir-<id>-evidence-<eventId>` | `apps/web/src/lib/pirDetail.test.ts` (7 tests) |
| Time scrubber | `apps/web/src/components/TimeScrubber.tsx` | `time-scrubber` | Manual |
| Camera strip + tile | `apps/web/src/components/CameraStrip.tsx`, `CameraTile.tsx` | `camera-<id>`, `cv-mode-*` | `apps/web/src/lib/detectionConfig.test.ts` |
| Drone detail panel | `apps/web/src/components/DroneDetailPanel.tsx` | `drone-<id>` | `apps/fabric/src/drone.test.ts` |
| Night-vision toggle | `apps/web/src/lib/store.ts` (`setNightVision`) | `topbar-nightvision` | Agent action `toggleNightVision` (see `agent.test.ts`) |
| Console noise filter | `apps/web/src/components/ConsoleFilter.tsx` | — | Manual |

### Button-level matrix (interactive controls users click)

| Button | Where | Action | Notes |
|---|---|---|---|
| **3D / 2D / Split view** | TopBar | `store.setView` | Switches between Cesium, MapLibre, and split |
| **Night vision** | TopBar | `store.setNightVision` | Tactical green-on-black palette |
| **Analyst** | TopBar | `store.setAnalystOpen` | Opens chat panel |
| **Overseer** | TopBar | `store.setOverseerOpen` | Opens autonomous agent panel |
| **Connectors** | TopBar | `location.assign('/connectors')` | Navigates to connector manager |
| **Camera ALL / YOLO / VLM / OFF** | CameraStrip | `store.setGlobalDetectionMode` | Switches detection mode for all tiles |
| **Per-tile detection mode** | CameraTile | `store.setCameras` | Overrides global mode per camera |
| **Drone follow toggle** | DroneDetailPanel | `store.setFollowDroneId` | Camera locks to drone track |
| **Generate briefing** | AnalystPanel | `runChat` with briefing system prompt | One-shot, no follow-up |
| **Voice input** | AnalystPanel | `voice.startRecording` (Whisper) | STT via `Xenova/whisper-tiny.en` |
| **TTS toggle** | AnalystPanel | `voice.speak` | Browser SpeechSynthesis |
| **Overseer Start / Pause / Stop** | OverseerPanel | `runOverseer`, stop flag | Esc also stops |
| **Filter chips** (category, severity) | IntelFeed / store | `store.toggleCategory`, `toggleSeverity`, `clearFilters` | Persisted in URL |

---

## 2. Map / Globe

| Feature | Source | Tests |
|---|---|---|
| 3D Cesium globe | `apps/web/src/components/Map3D.tsx` | Manual |
| 2D MapLibre map | `apps/web/src/components/Map2D.tsx` | Manual |
| Drone tracks (billboards + range ring) | `apps/web/src/components/DroneTrackLayer.tsx` | `apps/fabric/src/drone.test.ts` |
| `flyTo` action (programmatic + Analyst + Overseer) | `store.requestFlyTo` | `apps/web/src/lib/agent.test.ts` |
| `flyToTopEvent` action | `apps/web/src/lib/agent.ts` | `agent.test.ts` |

---

## 3. Intel feed & event lifecycle

| Feature | Source | Tests |
|---|---|---|
| Ingest event broadcast | `apps/fabric/src/index.ts` | `apps/fabric/src/db.test.ts` |
| Encrypted persistence | `apps/fabric/src/db.ts` (AES-256-GCM) | `apps/fabric/src/db.test.ts` |
| Rule engine (`AlertRule`) | `apps/fabric/src/alerts.ts` | `apps/fabric/src/alerts.test.ts` (23 cases) |
| Threat level (`ThreatCon`) + PIRs | `apps/fabric/src/threatcon.test.ts` | 5 cases |
| Topic tagging worker | `apps/web/src/components/topicWorker.ts` | Manual |

---

## 4. Camera + Computer-Vision pipeline

### 4.1 Streams

`CameraTile` supports MJPEG, HLS, WebRTC (via go2rtc), and YouTube embeds.
Stream kind is `camera.kind`; failures flip `status` to `offline` and stop
detection submission.

### 4.2 Detection modes

Modes are driven by `apps/web/src/lib/detectionConfig.ts`:

| Mode | Behavior |
|---|---|
| `off` | No frames submitted to any worker |
| `yolo` | Frames go to `droneDetectorWorker` only (object detection) |
| `vlm` | Frames go to `visionWorker` only (open-vocabulary VLM) — **requires `camera.detectors[]` non-empty** |
| `both` | Frames go to BOTH workers via independent `ArrayBuffer.slice(0)` copies |

A global default lives in `store.globalDetectionMode`. Each `CameraFeed` can
override via `camera.detectionMode`.

### 4.3 Workers

| Worker | Source | Model | Engine singleton |
|---|---|---|---|
| YOLO / object detection | `apps/web/src/components/droneDetectorWorker.ts` | `Xenova/detr-resnet-50` (COCO, 91 classes) | `lib/droneDetectorWorkerEngine.ts` |
| Open-vocabulary VLM | `apps/web/src/components/visionWorker.ts` | `onnx-community/LFM2-VL-450M-ONNX` | `lib/visionEngine.ts` |
| Drone RF feature extractor | `apps/web/src/components/droneWorker.ts` | Heuristic + zero-shot NLI (`Xenova/nli-deberta-v3-xsmall`) | Inline |
| Topic tagger | `apps/web/src/components/topicWorker.ts` | `Xenova/nli-deberta-v3-xsmall` | Inline |

All workers attempt **WebGPU first, fall back to WASM/q8** on failure, surface
`status: "ready" \| "loading" \| "error"`, and both worker `onmessage` and
`onerror` are wired so an init failure flips status to `"error"`.

### 4.4 Drone-like classification

`droneDetectorEngine.ts` exports `DRONE_COCO_CLASSES = ["airplane","bird","kite"]`.
Detections whose label matches any of these are flagged `isDroneLike=true`, and
the synthesized `DroneCvEvent` is upgraded to severity `"high"`.

### 4.5 Tested invariants

| Invariant | Test |
|---|---|
| `parseDetections` filters below threshold | `droneDetectorEngine.test.ts` |
| `parseDetections` marks COCO drone-like labels | same |
| `buildDroneCvEvent` returns `severity:"high"` for drone-like | same |
| `buildDroneCvEvent` returns `severity:"info"` when empty | same |
| `detectionModesForCamera` returns correct array for each mode | `detectionConfig.test.ts` |
| `droneDetectorModelId` uses a Transformers.js-supported arch | same |
| `droneDetectorModelId` does NOT reference `yolov(8\|10\|11)` | same |

---

## 5. AI assistants

### 5.1 Analyst

- **Model selector** (default: `HuggingFaceTB/SmolLM2-360M-Instruct`).
- **System prompt** anchors identity ("on-device via `@huggingface/transformers`")
  to prevent fabricated framework claims (TF/PyTorch/Gluon).
- The selected `MODEL_ID` is injected into the system prompt so "what model are
  you" can be answered factually.
- `runChat` enforces `repetition_penalty: 1.2`, `no_repeat_ngram_size: 6`, and
  calls `detectRepetitionLoop` on each streamed token to abort degenerate output.

### 5.2 Overseer

- **Model**: `HuggingFaceTB/SmolLM2-360M-Instruct` (small, ~360M params).
- **Prompt** uses few-shot examples to nudge small models toward strict JSON.
- **Allowed actions** (canonical list): see `agent.ts SYSTEM`.
- **Parser** (`parseAction`) tolerates:
  - Markdown code fences
  - Thought text prefixing the JSON
  - Multiple JSON objects (picks first valid `action`)
  - Trailing commas
  - Single-quoted keys *and* values
- **Action executor** (`executeAction`) maps each parsed action to a `store`
  method or DOM click against `[data-agent="..."]`. Anything else returns
  `"unknown action <x>"`.

### 5.3 Tests covering AI behavior

| Test file | Coverage |
|---|---|
| `apps/web/src/lib/ai.test.ts` | `detectRepetitionLoop` (5 cases) |
| `apps/web/src/lib/agent.test.ts` | `parseAction` (10 cases) + `extractThought` (4 cases) |
| `apps/web/src/lib/detectionConfig.test.ts` | model id constraints (13 cases) |
| `apps/web/src/lib/droneDetectorEngine.test.ts` | parsing + event building (14 cases) |

---

## 6. Connector catalog

22 connectors live in `packages/connectors/src/sources/`. The catalog is
exported via `ALL_CONNECTORS` in `packages/connectors/src/index.ts`. Each
connector exports `{ id, label, configSchema, defaultConfig, start }`.

| Connector | File |
|---|---|
| NWS alerts | `nws.ts` |
| USGS earthquakes | `usgs.ts` |
| EMSC earthquakes | `emsc.ts` |
| EONET natural events | `eonet.ts` |
| OpenAQ air quality | `openaq.ts` |
| OpenSky flights | `opensky.ts` |
| ISS position | `iss.ts` |
| GDELT news | `gdelt.ts` |
| Hacker News | `hn.ts` |
| Reddit | `reddit.ts` |
| GitHub | `github.ts` |
| Open-Meteo | `openmeteo.ts` |
| CoinGecko | `coingecko.ts` |
| SpaceX launches | `spacex.ts` |
| NOAA SWPC space weather | `noaa-swpc.ts` |
| Wikipedia recent changes | `wikipedia-rc.ts` |
| NASA FIRMS fires | `nasa-firms.ts` |
| MQTT | `mqtt.ts` |
| Webhook | `webhook.ts` |
| RSS | `rss.ts` |
| REST poller | `rest-poller.ts` |
| Demo simulator | `demo.ts` |
| Drone RF | `drone-rf.ts` (5 unit tests) |

To add one, follow `AGENTS.md → Adding a New Connector`.

---

## 7. Real-time data flow

```
RF / API / IoT ─► Connector ─► Orchestrator ─► Rule + Drone aggregators
                                          │
                                          ├─► SQLite (encrypted configs)
                                          └─► /ws broadcast ─► Zustand store
                                                                │
              ┌────────────────────────┬───────────────────────┤
              ▼                        ▼                       ▼
        Cesium globe              MapLibre map           Analyst/Overseer
              │                        │                       │
              └────────► CameraTile ──┴── visionEngine + droneDetectorEngine
                              │
                              └─► POST /api/cv-event ─► broadcast
```

`ServerToClient` discriminated union (`packages/schemas/src/index.ts`):

`event` · `status` · `threatcon` · `pir` · `hello` · `snapshot` · `alert`
· `rules` · `drone-track` · `cv-detection`

---

## 8. AI model registry

| Purpose | Model id | Loader | Notes |
|---|---|---|---|
| Analyst chat (default) | `HuggingFaceTB/SmolLM2-360M-Instruct` | `runChat` | text-generation, q4f16 on WebGPU |
| Analyst chat (option) | `HuggingFaceTB/SmolLM2-1.7B-Instruct` | same | larger, better reasoning |
| Analyst chat (option) | `onnx-community/Qwen2.5-0.5B-Instruct` | same | fast |
| Analyst chat (option) | `onnx-community/Llama-3.2-1B-Instruct` | same | balanced |
| Camera VLM (open vocab) | `onnx-community/LFM2-VL-450M-ONNX` | `visionWorker` | image-text-to-text, WebGPU fp16/q4f16 → WASM q8 fallback |
| Camera object detection | `Xenova/detr-resnet-50` | `droneDetectorWorker` | object-detection, WebGPU fp16 → WASM q8 fallback |
| Overseer vision caption | `Xenova/vit-gpt2-image-captioning` | `runVisionCaption` | image-to-text |
| Topic / drone-RF NLI | `Xenova/nli-deberta-v3-xsmall` | inline workers | zero-shot classification |
| Voice STT | `Xenova/whisper-tiny.en` | `lib/voice.ts` | automatic-speech-recognition |

**Unsupported architectures** (will throw `Unsupported model type`):
YOLOv5/v7/v8/v10/v11, custom AXERA `.axmodel`, MMDetection/YOLOv8u checkpoints.
Transformers.js only supports DETR, YOLOS, OWL-ViT, RT-DETR for the
`object-detection` task as of v4.x.

---

## 9. How to add a new feature

1. Implement the change.
2. Add it to the appropriate table in this file.
3. Add at least one unit test in the nearest `*.test.ts`.
4. Run `pnpm verify && pnpm test` and make sure it all passes.
