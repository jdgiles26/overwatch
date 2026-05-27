# 07 — Drone MobileViT classifier · TDD checklist

Path A (wire the real model):

- [ ] `droneWorker.ts` initialises an ONNX session for MobileViT XXS.
- [ ] Test: with the model loaded, a synthetic "drone-shaped" input
      tensor returns `isDroneLike: true` above threshold.
- [ ] Test: a known non-drone tensor returns `isDroneLike: false`.
- [ ] `docs/plans/2026-05-05-drone-airspace-detection.md` no longer
      contains a `TODO` referencing the missing artifact.

Path B (delete the promise):

- [ ] `docs/plans/2026-05-05-drone-airspace-detection.md` MobileViT
      references removed.
- [ ] `docs/FEATURES.md §4.4` describes the synthetic NLI classifier
      as the implementation, not a placeholder.
