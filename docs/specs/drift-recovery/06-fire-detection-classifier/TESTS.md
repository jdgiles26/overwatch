# 06 — Fire detection · TDD checklist

Path A (real classifier):

- [ ] `cvWorker.ts` imports an image-classification pipeline.
- [ ] Edge-density heuristic at `cvWorker.ts:~30` is removed.
- [ ] Test: a synthetic all-black frame does NOT emit `fire`.
- [ ] Test: a frame below the confidence threshold does NOT emit `fire`.
- [ ] `docs/FEATURES.md §8` lists the model.

Path B (rename + demote):

- [ ] Event class renamed everywhere from `fire` to
      `high-edge-density-region`.
- [ ] `severity` for the new class is `info` (not `high`).
- [ ] `@overwatch/schemas` `CvEvent` enum updated; consumers compile.
- [ ] `docs/FEATURES.md §4` no longer implies fire detection works.
- [ ] `future/IDEAS.md` has a row for "real fire classifier" if not
      already present (#1 is close — consolidate, don't duplicate).
