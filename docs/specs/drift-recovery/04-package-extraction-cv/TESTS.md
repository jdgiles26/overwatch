# 04 — `@overwatch/cv` · TDD checklist

- [ ] `packages/cv/src/workers/cv.ts`, `vision.ts`, `drone.ts` exist.
- [ ] `packages/cv/src/protocol.ts` exports `CvFrameMsg`, `CvDetectionMsg`.
- [ ] `packages/cv/src/engine.ts` exports `CvEngine` with
      `attachCamera`, `detachCamera`, `on('detection', ...)`.
- [ ] No file in `packages/cv/src/` imports from `apps/web/*`.
- [ ] `apps/web/src/components/CameraTile.tsx` imports `CvEngine`
      from `@overwatch/cv`.
- [ ] Browser smoke: camera tile in YOLO / VLM / BOTH modes still
      emits `cv-detection` events to the fabric — verify via
      `/api/cv-event` request count.
- [ ] `packages/cv/README.md` placeholder banner removed.
