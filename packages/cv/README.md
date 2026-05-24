# @overwatch/cv

**Status:** placeholder — reserved for browser-side computer-vision Workers.

## Planned scope

Per-camera Web Workers that run motion, fire, and edge heuristics on
ImageData frames, plus a VLM-backed detector and the drone-RF signal
analyzer. Workers emit `cv` events back to the fabric via
`POST /api/cv-event` (and `drone-rf` events via WebSocket).

| Worker | Job |
|---|---|
| `cvWorker` | Frame-diff motion, fire heuristic, edge density |
| `visionWorker` | VLM detection (LFM2.5-VL-450M-ONNX) on sampled frames |
| `droneWorker` | RF signal processing + heuristic threat classification |

## Where the code currently lives

| Concern | Current location |
|---|---|
| Motion / fire / edge heuristics | `apps/web/src/components/cvWorker.ts` |
| VLM detector | `apps/web/src/components/visionWorker.ts` |
| Drone RF processing | `apps/web/src/components/droneWorker.ts` |
| Vision engine that fans out per camera | (inline in `apps/web/src/components/CameraTile.tsx`) |
| CvEvent / DroneTrack schemas | `packages/schemas/src/index.ts` |

## Extraction plan

1. Move the three worker files to `packages/cv/src/workers/*.ts`.
2. Add `packages/cv/src/engine.ts` exporting the per-camera fan-out
   logic currently embedded in `CameraTile.tsx`.
3. Define a small typed message protocol (`CvFrameMsg`, `CvDetectionMsg`)
   in `packages/cv/src/protocol.ts` so the host app can construct
   workers via `new Worker(new URL('@overwatch/cv/workers/cvWorker',
   import.meta.url))` (Next.js native worker syntax).
4. Keep `CvEvent` types in `@overwatch/schemas` (already there) and
   import them here.

## Blockers

- Next.js worker imports use `new URL(..., import.meta.url)` and need
  the worker file to be discoverable at build time — extracting may
  require a small Next config tweak.
- VLM model size (450 MB) + WebGPU constraints stay browser-only;
  this package is not Node-runnable.

## Dependencies (planned)

- `@overwatch/schemas` — CvEvent / DroneTrack types
- `@huggingface/transformers` (peer — VLM only)
