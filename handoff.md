# OverWatch — Agent Handoff Document

> Last updated: 2026-05-24 | Session: drone-detection-integration + bug-fix + skill-creation

## Current Branch & State

- **Branch**: `main`
- **Uncommitted changes**: 10 modified, 8 untracked (see `git status` below)
- **Tests**: 125/125 pass (46 web + 74 fabric + 5 connectors)
- **Typecheck**: Clean
- **Lint**: Clean

## What Was Done This Session

### 1. Drone Detection Feature Integration (from prior session, carried forward)

Replaced the initial spec (AXERA-TECH/Drone-axera + NVIDIA Memotron — both unsupported) with browser-native alternatives:

| Component | Model | Architecture |
|-----------|-------|--------------|
| Object detection (drone) | `Xenova/detr-resnet-50` | DETR (COCO 91 classes) |
| Open-vocabulary VLM | `onnx-community/LFM2-VL-450M-ONNX` | LFM2-VL |

Original `yolov10s` failed with `Unsupported model type: yolov10` — Transformers.js only supports DETR/YOLOS/OWL-ViT/RT-DETR for object-detection.

### 2. Bug Fixes (P0/P1/P2 from code review)

| Priority | Issue | Fix | File(s) |
|----------|-------|-----|---------|
| **P0** | ArrayBuffer double-transfer in "both" mode | `source.slice(0)` per worker instead of shared buffer | `CameraTile.tsx` |
| **P1** | VLM frames sent but handler not registered when `detectors` empty | Folded `hasDetectors` into `hasVlm` flag | `CameraTile.tsx` |
| **P1** | No WebGPU→WASM fallback in droneDetectorWorker | Inner try/catch + WASM/q8 fallback | `droneDetectorWorker.ts` |
| **P1** | Analyst hallucinates TF/PyTorch/Gluon identity | Anchored system prompt + MODEL_ID injection | `AnalystPanel.tsx` |
| **P1** | Repetition loop ("a model of a model...") | `detectRepetitionLoop` guard + `repetition_penalty: 1.2` + `no_repeat_ngram_size: 6` | `ai.ts` |
| **P1** | Overseer outputs "say (no commentary)" not JSON | Few-shot examples + strict JSON-only format | `agent.ts` |
| **P2** | `loading` flag not reset on success | Added `loading = false` before `ready = true` | `droneDetectorWorker.ts` |
| **P2** | Missing `onerror` handler on worker engines | Added `_worker.onerror` + status flip | `droneDetectorWorkerEngine.ts`, `visionEngine.ts` |

### 3. New Files Created

| File | Purpose |
|------|---------|
| `apps/web/src/lib/detectionConfig.ts` | DetectionMode enum, model IDs, parseDetectionMode |
| `apps/web/src/lib/detectionConfig.test.ts` | 13 tests — mode parsing, model ID validation |
| `apps/web/src/lib/droneDetectorEngine.ts` | Pure-logic: parseDetections, buildDroneCvEvent, DRONE_COCO_CLASSES |
| `apps/web/src/lib/droneDetectorEngine.test.ts` | 14 tests — parsing, classification, event building |
| `apps/web/src/lib/droneDetectorWorkerEngine.ts` | Singleton engine for YOLO/DETR worker |
| `apps/web/src/components/droneDetectorWorker.ts` | Web Worker — DETR pipeline with WebGPU→WASM fallback |
| `apps/web/src/lib/agent.test.ts` | 14 tests — parseAction + extractThought |
| `apps/web/src/lib/ai.test.ts` | 5 tests — detectRepetitionLoop |
| `docs/FEATURES.md` | Exhaustive feature inventory (buttons, models, tests, data flow) |
| `.factory/skills/feature-verify-fix/SKILL.md` | 7-phase review→TDD→UI→fix→retest→document skill |
| `.factory/skills/feature-verify-fix/checklists.md` | Per-phase verification checklists |
| `.factory/skills/feature-verify-fix/references.md` | Project test commands, model registry, past findings |

### 4. Skill Created

`feature-verify-fix` skill at `.factory/skills/feature-verify-fix/` — 7-phase loop:
REVIEW → TDD → UI/UX TEST → DOCUMENT ISSUES → FIX with TDD → RE-TEST UI → DOCUMENT FINAL

## Uncommitted Changes (git status)

```
 M apps/web/package.json
 M apps/web/src/components/AnalystPanel.tsx
 M apps/web/src/components/CameraStrip.tsx
 M apps/web/src/components/CameraTile.tsx
 M apps/web/src/components/visionWorker.ts
 M apps/web/src/lib/agent.ts
 M apps/web/src/lib/ai.ts
 M apps/web/src/lib/store.ts
 M apps/web/src/lib/visionEngine.ts
 M packages/schemas/src/index.ts
 M pnpm-lock.yaml
?? apps/web/src/components/droneDetectorWorker.ts
?? apps/web/src/lib/agent.test.ts
?? apps/web/src/lib/ai.test.ts
?? apps/web/src/lib/detectionConfig.test.ts
?? apps/web/src/lib/detectionConfig.ts
?? apps/web/src/lib/droneDetectorEngine.test.ts
?? apps/web/src/lib/droneDetectorEngine.ts
?? apps/web/src/lib/droneDetectorWorkerEngine.ts
?? docs/FEATURES.md
```

## Known Issues / Open Items

1. **No git commit yet** — All changes above are uncommitted. A commit should be made before starting new work.
2. **No UI/UX browser test performed** — The `agent-browser` skill should be used to verify camera detection toggle (ALL/YOLO/VLM/OFF), Analyst chat, and Overseer actions in the browser.
3. **ConsoleFilter.tsx line 39 still shows error frame** — This is expected behavior (it re-emits real errors); the root cause (`Unsupported model type: yolov10`) is now fixed.
4. **DETR model may be slow on WASM** — `Xenova/detr-resnet-50` is heavier than YOLOS-tiny. If inference is too slow, consider downgrading to `Xenova/yolos-tiny`.
5. **Analyst still uses SmolLM2-360M by default** — This model is prone to hallucination and repetition. The 1.7B variant or Qwen2.5-0.5B are available in the dropdown but not default.
6. **No E2E smoke test for CV detection pipeline** — `scripts/smoke-drone.ts` covers the RF pipeline but not the camera-based detection pipeline.

## Test Coverage Summary

| Package | Tests | Key files |
|---------|-------|-----------|
| `@overwatch/web` | 46 | `detectionConfig.test.ts` (13), `droneDetectorEngine.test.ts` (14), `agent.test.ts` (14), `ai.test.ts` (5) |
| `@overwatch/fabric` | 74 | `alerts.test.ts` (23), `db.test.ts` (23), `orchestrator.test.ts` (17), `drone.test.ts` (6), `threatcon.test.ts` (5) |
| `@overwatch/connectors` | 5 | `drone-rf.test.ts` (5) |

## AI Model Registry

| Purpose | Model ID | Loader | Status |
|---------|----------|--------|--------|
| Analyst chat | `HuggingFaceTB/SmolLM2-360M-Instruct` | `runChat` | Working, prone to hallucination |
| Analyst (option) | `HuggingFaceTB/SmolLM2-1.7B-Instruct` | same | Available in dropdown |
| Analyst (option) | `onnx-community/Qwen2.5-0.5B-Instruct` | same | Available in dropdown |
| Analyst (option) | `onnx-community/Llama-3.2-1B-Instruct` | same | Available in dropdown |
| Camera VLM | `onnx-community/LFM2-VL-450M-ONNX` | `visionWorker` | Working |
| Camera object detection | `Xenova/detr-resnet-50` | `droneDetectorWorker` | Working (replaces broken yolov10s) |
| Overseer vision | `Xenova/vit-gpt2-image-captioning` | `runVisionCaption` | Working |
| Topic/NLI | `Xenova/nli-deberta-v3-xsmall` | inline | Working |
| Voice STT | `Xenova/whisper-tiny.en` | `voice.ts` | Working |

## Commands Reference

```bash
pnpm verify && pnpm test   # Full CI check (typecheck + lint + all tests)
pnpm --filter @overwatch/web test    # Web tests only
pnpm --filter @overwatch/fabric dev  # Start backend on :4311
pnpm --filter @overwatch/web dev    # Start frontend on :3311
```
