# 04 — Extract `@overwatch/cv`

## Goal

Move the three Web Workers (`cvWorker`, `visionWorker`, `droneWorker`)
and the per-camera fan-out logic into `packages/cv/`. The web app
constructs workers via `new Worker(new URL('@overwatch/cv/workers/...',
import.meta.url))`.

## Non-goals

- Replacing the heuristic fire detector (that is spec 06).
- Replacing the synthetic drone classifier (that is spec 07).
- Changing the on-the-wire `CvEvent` schema (lives in `@overwatch/schemas`).

## Scope

| Move | From | To |
|---|---|---|
| Motion/fire/edge worker | `apps/web/src/components/cvWorker.ts` | `packages/cv/src/workers/cv.ts` |
| VLM worker | `apps/web/src/components/visionWorker.ts` | `packages/cv/src/workers/vision.ts` |
| Drone RF worker | `apps/web/src/components/droneWorker.ts` | `packages/cv/src/workers/drone.ts` |
| Per-camera fan-out | inline in `CameraTile.tsx` | `packages/cv/src/engine.ts` |
| Message types | inline | `packages/cv/src/protocol.ts` |

## Public contract

```ts
import { CvEngine } from "@overwatch/cv";
import type { CvFrameMsg, CvDetectionMsg } from "@overwatch/cv/protocol";

const engine = new CvEngine({ workerFactory: (kind) => new Worker(...) });
engine.attachCamera(camera);
engine.on("detection", (msg: CvDetectionMsg) => post(msg));
```

`CameraTile.tsx` becomes a thin wrapper that constructs the workers
and hands them to `CvEngine`.

## Done-when

- All three worker files live in `packages/cv/src/workers/`.
- `packages/cv/src/protocol.ts` exports `CvFrameMsg` / `CvDetectionMsg`.
- `apps/web/src/components/CameraTile.tsx` consumes `CvEngine` instead
  of constructing workers inline.
- `packages/cv/README.md` placeholder banner removed.
- `pnpm verify` and `pnpm drift` are green.

## Risks

- Next.js's worker syntax is sensitive to the import-meta URL form.
  Test the move in the actual app, not just a unit test.
