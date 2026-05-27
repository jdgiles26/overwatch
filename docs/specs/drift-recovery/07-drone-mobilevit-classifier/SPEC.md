# 07 — Drone MobileViT XXS classifier wiring

## Goal

`docs/plans/2026-05-05-drone-airspace-detection.md:277` describes the
drone airspace classifier as a placeholder until a MobileViT XXS ONNX
artifact lands. Wire the real artifact, or drop the unfulfilled
promise.

## Non-goals

- Training the model.
- Replacing the NLI zero-shot fallback.

## Scope

| Option | Description |
|---|---|
| A | Vendor a MobileViT XXS ONNX file (≤6 MB) under `packages/cv/assets/` (gitignored if large; pull from CDN at first run) and wire it in `droneWorker.ts`. |
| B | Delete the `TODO` and the "MobileViT" line in the plan doc; document the synthetic NLI classifier as the intended permanent solution. |

## Done-when

- Either: the drone worker loads MobileViT XXS at startup and the
  synthetic classifier becomes a fallback path; or
- The plan doc no longer mentions MobileViT, and `docs/FEATURES.md`
  §4.4 is the canonical description of how drone-like classification
  works today.
- `DRIFT.md §4.2` row deleted.

## Risks

- ONNX-runtime-web in a Web Worker has cold-start cost. Measure
  before shipping option A.
