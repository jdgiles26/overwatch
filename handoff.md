# OverWatch — Agent Handoff Document

> Last updated: 2026-05-24 | Session: 3-tier-fallback-with-error-notification

## Current Branch & State

- **Branch**: `main`
- **Uncommitted changes**: see `git status` below
- **Tests**: 164/164 pass (90 web + 74 fabric + connectors)
- **Typecheck**: Clean
- **Lint**: Clean
- **Build**: `pnpm --filter @overwatch/web build` succeeds

## Current Architecture: 3-Tier Fallback with Persistent Error Notifications

All on-device AI pipelines use a **3-tier backend chain (WebGPU → WebGL → WASM)** for maximum functionality. When the device falls back from the preferred tier, a **persistent error** is pushed to the `<ErrorBanner>` so the user knows performance will be degraded. The app **never silently degrades** — every fallback is surfaced to the user.

| Pipeline | WebGPU | WebGL | WASM | On fallback |
|----------|--------|-------|------|-------------|
| VLM scene description | Transformers.js LFM2-VL-450M (fp16/q4f16) | TF.js + MobileNet v2 (ImageNet → templated summary) | Transformers.js LFM2-VL-450M (q8) | `<ErrorBanner>` shows "WebGPU unavailable for VLM — falling back to WebGL" |
| Drone object detection | Transformers.js DETR (fp16) | TF.js + coco-ssd@lite_mobilenet_v2 | Transformers.js DETR (q8) | `<ErrorBanner>` shows "WebGPU unavailable for drone detector — falling back to WebGL" |
| Analyst LLM | Transformers.js (WebGPU) | — | Transformers.js (WASM q8) | `<ErrorBanner>` shows "WebGPU not detected — using WASM" |
| Overseer / caption | Same as Analyst | — | Same as Analyst | Same as Analyst |
| Whisper STT | Same as Analyst | — | Same as Analyst | Same as Analyst |
| Frame capture | OffscreenCanvas (singleton) | DOM `<canvas>` (fallback) | — | `<ErrorBanner>` shows "OffscreenCanvas unavailable — using DOM canvas" |

**Key principle**: maximum functionality preserved. Every tier works. But the user is always notified when not running on the best available backend.

Note: `droneWorker.ts` (NLI drone classification) and `topicWorker.ts` (NLI topic tagging) use `device: "wasm"` as a deliberate single-backend choice — not as a fallback — because the deberta-v3-xsmall NLI model is sensitive on WebGPU.

## Fallback Notification Pattern

Workers emit `status:"fallback"` messages during the tier chain:

```
tryLoadWebGPU() → fail → postMessage({ type: "status", status: "fallback", message: "..." })
tryLoadWebGL()  → fail → postMessage({ type: "status", status: "fallback", message: "..." })
tryLoadWasm()   → ok   → postMessage({ type: "status", status: "ready", device: "wasm" })
```

Engines (`visionEngine.ts`, `droneDetectorWorkerEngine.ts`) handle `status:"fallback"` by calling `useStore.getState().pushError(...)`. When a higher tier succeeds later (e.g. WebGPU succeeds after initial failure), the error is dismissed via `dismissError(key)`.

For the analyst/overseer/whisper pipelines in `ai.ts`, the `getOrCreatePipeline()` function uses `detectDevice()` and pushes errors directly via `pushFallbackError()` / clears via `clearFallbackError()`.

## Files Created / Modified This Session

### Created (new)

| File | Purpose |
|------|---------|
| `apps/web/src/lib/errors.ts` | `upsertError`, `removeErrorByKey`, `AppError` type |
| `apps/web/src/lib/errors.test.ts` | 5 tests |
| `apps/web/src/lib/toasts.ts` | `createToast`, `removeToastById`, `pruneExpiredToasts`, `Toast` type |
| `apps/web/src/lib/toasts.test.ts` | 7 tests |
| `apps/web/src/lib/boundingBox.ts` | `normalizeBoxToPercent`, `severityColorForLabel`, `isDrawableBox` |
| `apps/web/src/lib/boundingBox.test.ts` | 10 tests |
| `apps/web/src/lib/frameCapture.ts` | OffscreenCanvas singleton + DOM canvas fallback, `captureFrameRGBA` |
| `apps/web/src/lib/frameCapture.test.ts` | 5 tests |
| `apps/web/src/lib/backendSelector.ts` | `selectDetectorBackend` priority chain, `detectBackendCapabilities` |
| `apps/web/src/lib/backendSelector.test.ts` | 5 tests |
| `apps/web/src/lib/cocoSsdAdapter.ts` | `cocoSsdToDetectorRaw` — coco-ssd bbox → DetectorRawOutput |
| `apps/web/src/lib/cocoSsdAdapter.test.ts` | 4 tests |
| `apps/web/src/lib/mobilenetVlmAdapter.ts` | `formatMobilenetSummary`, `buildVlmFocusHint` |
| `apps/web/src/lib/mobilenetVlmAdapter.test.ts` | 8 tests |
| `apps/web/src/components/ToastContainer.tsx` | Transient auto-pruning toast stack, fixed bottom-right |
| `apps/web/src/components/ErrorBanner.tsx` | Persistent red banner fixed top-center, dismissible per-error |
| `apps/web/src/components/BoundingBoxOverlay.tsx` | SVG overlay with Gaussian blur glow, severity colors, label badges |
| `apps/web/src/components/droneDetectorWorker.ts` | Web Worker — 3-tier DETR chain (WebGPU → WebGL coco-ssd → WASM) |
| `apps/web/src/lib/detectionConfig.ts` | DetectionMode enum, model IDs, parseDetectionMode |
| `apps/web/src/lib/detectionConfig.test.ts` | 13 tests |
| `apps/web/src/lib/droneDetectorEngine.ts` | Pure-logic: parseDetections, buildDroneCvEvent, DRONE_COCO_CLASSES |
| `apps/web/src/lib/droneDetectorEngine.test.ts` | 14 tests |
| `apps/web/src/lib/droneDetectorWorkerEngine.ts` | Singleton engine for drone detector worker |
| `apps/web/src/lib/agent.test.ts` | 14 tests |
| `apps/web/src/lib/ai.test.ts` | 5 tests |

### Modified

| File | Changes |
|------|---------|
| `apps/web/src/components/visionWorker.ts` | 3-tier chain: WebGPU→WebGL(MobileNet)→WASM + `status:"fallback"` notifications |
| `apps/web/src/lib/visionEngine.ts` | Handles `status:"fallback"` → pushError; clears on WebGPU success; onerror handler |
| `apps/web/src/lib/droneDetectorWorkerEngine.ts` | Handles `status:"fallback"` → pushError; clears on WebGPU success; onerror handler |
| `apps/web/src/lib/ai.ts` | `detectDevice()` returns "webgpu"|"wasm"; `getOrCreatePipeline` with WebGPU→WASM fallback + error notification; `detectRepetitionLoop` guard; `repetition_penalty: 1.2`, `no_repeat_ngram_size: 6` |
| `apps/web/src/lib/store.ts` | Added `toasts`, `errors`, `yoloBackend`, `vlmBackend` slices + actions |
| `apps/web/src/components/CameraTile.tsx` | OffscreenCanvas frame capture with DOM fallback, BoundingBoxOverlay, pushError on fallback |
| `apps/web/src/components/AnalystPanel.tsx` | device state type `"webgpu" | "wasm" | "cpu" | null` |
| `apps/web/src/lib/agent.ts` | Uses `detectDevice` (from `ai.ts`) instead of `requireWebGpu` |
| `apps/web/src/lib/voice.ts` | Uses `getOrCreatePipeline` (WebGPU→WASM with error notification) |
| `apps/web/src/app/layout.tsx` | Added `<ErrorBanner />` + `<ToastContainer />` |
| `apps/web/package.json` | Added `@tensorflow/tfjs`, `@tensorflow-models/coco-ssd`, `@tensorflow-models/mobilenet` + `vitest` devDep |
| `pnpm-workspace.yaml` | `core-js: false` in allowBuilds |
| `packages/schemas/src/index.ts` | DetectionMode, CameraFeed.detectionMode, CameraFeed.detectors |

## Dependencies Added

| Package | Purpose |
|---------|---------|
| `@tensorflow/tfjs` | WebGL backend for TF.js models |
| `@tensorflow-models/coco-ssd` | WebGL-accelerated object detection (fallback for drone detector) |
| `@tensorflow-models/mobilenet` | WebGL-accelerated image classification (fallback for VLM) |
| `vitest` (devDep) | Test runner for web app |

## Uncommitted Changes (git status)

All changes above are uncommitted. Run `git status` for the full list.

## Known Issues / Open Items

1. **No git commit yet** — All changes above are uncommitted.
2. **No UI/UX browser test performed** — agent-browser smoke verified basic rendering but no WebGPU/WebGL functionality test possible in headless Chromium (no WebGPU support).
3. **DETR model may be slow on WASM** — Consider `Xenova/yolos-tiny` if too slow.
4. **Analyst still uses SmolLM2-360M by default** — Prone to hallucination; 1.7B variant available in dropdown.

## Test Coverage Summary

| Package | Tests | Key files |
|---------|-------|-----------|
| `@overwatch/web` | 90 | `detectionConfig.test.ts` (13), `droneDetectorEngine.test.ts` (14), `agent.test.ts` (14), `ai.test.ts` (5), `toasts.test.ts` (7), `boundingBox.test.ts` (10), `frameCapture.test.ts` (5), `errors.test.ts` (5), `backendSelector.test.ts` (5), `cocoSsdAdapter.test.ts` (4), `mobilenetVlmAdapter.test.ts` (8) |
| `@overwatch/fabric` | 74 | `alerts.test.ts` (23), `db.test.ts` (23), `orchestrator.test.ts` (17), `drone.test.ts` (6), `threatcon.test.ts` (5) |
| `@overwatch/connectors` | 5 | `drone-rf.test.ts` (5) |

## AI Model Registry

| Purpose | Model ID | Loader | Status |
|---------|----------|--------|--------|
| Analyst chat | `HuggingFaceTB/SmolLM2-360M-Instruct` | `runChat` | Working, prone to hallucination |
| Analyst (option) | `HuggingFaceTB/SmolLM2-1.7B-Instruct` | same | Available in dropdown |
| Analyst (option) | `onnx-community/Qwen2.5-0.5B-Instruct` | same | Available in dropdown |
| Analyst (option) | `onnx-community/Llama-3.2-1B-Instruct` | same | Available in dropdown |
| Camera VLM | `onnx-community/LFM2-VL-450M-ONNX` | `visionWorker` | Working (WebGPU/WebGL/WASM) |
| Camera VLM (WebGL) | `@tensorflow-models/mobilenet` v2 α=1.0 | `visionWorker` | Working (WebGL fallback) |
| Camera object detection | `Xenova/detr-resnet-50` | `droneDetectorWorker` | Working (WebGPU/WASM) |
| Camera object detection (WebGL) | `@tensorflow-models/coco-ssd` lite_mobilenet_v2 | `droneDetectorWorker` | Working (WebGL fallback) |
| Overseer vision | `Xenova/vit-gpt2-image-captioning` | `runVisionCaption` | Working |
| Topic/NLI | `Xenova/nli-deberta-v3-xsmall` | inline | Working |
| Voice STT | `Xenova/whisper-tiny.en` | `voice.ts` | Working |

## Commands Reference

```bash
pnpm verify && pnpm test   # Full CI check (typecheck + lint + all tests)
pnpm --filter @overwatch/web test    # Web tests only (90 tests)
pnpm --filter @overwatch/fabric dev  # Start backend on :4311
pnpm --filter @overwatch/web dev     # Start frontend on :3311
```
