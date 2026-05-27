# 06 — Fire detection: classifier or rename

## Goal

`apps/web/src/components/cvWorker.ts:30` emits `cv-detection` events
labelled `fire` based on edge density. The UI presents these as
genuine fire detections; downstream rule engine + THREATCON treat
them as such. Either replace the heuristic with a real classifier,
or rename the class and visually demote it.

## Non-goals

- Training a model. Pull a pre-trained checkpoint.
- Building a fire-localisation bbox model (binary present/absent is enough).

## Options

### Option A — replace with a real classifier

Use `Xenova/vit-base-patch16-224` (or smaller) zero-shot, prompt
{"fire", "smoke", "ordinary scene"} via `@xenova/transformers`
image-classification pipeline. Run in the existing CV worker.

### Option B — rename and demote

Rename event class from `fire` to `high-edge-density-region`, drop
the severity from `high` to `info`, document in `docs/FEATURES.md`
that fire detection is not currently implemented. Move the real
classifier ask into `future/IDEAS.md`.

Pick **A or B** in the implementing PR. B is the honest fallback if
the model size makes the existing camera pipeline unacceptably slow.

## Done-when

- Either: `cvWorker.ts` calls a real image-classification model and
  emits `fire` only on a confidence threshold; or every reference to
  `fire` as a detection class is renamed and the UI / rule engine /
  schema reflect that.
- `docs/FEATURES.md` either documents the model under §8, or removes
  the implicit "fire detection works" claim from §4.
- `DRIFT.md §4.1` row is deleted.
- New tests: at least one assertion that a confidence-below-threshold
  frame does *not* emit a `fire` event.

## Risks

- Adding another worker model balloons cold-start time. Measure
  before shipping.
