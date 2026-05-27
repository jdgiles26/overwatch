# 03 — Extract `@overwatch/ai`

## Goal

Lift the on-device LLM, VLM, and caption wrappers (today scattered
across `apps/web/src/lib/ai.ts` and the camera-side workers) into
`packages/ai/` as a worker-safe, DOM-free module.

## Non-goals

- Replacing the model registry.
- Changing the 3-tier WebGPU → WebGL → WASM fallback ordering.
- Server-side inference (covered by `future/IDEAS.md` #4).

## Scope

| Move | From | To |
|---|---|---|
| LLM wrapper, model select, fallback | `apps/web/src/lib/ai.ts` | `packages/ai/src/llm.ts` |
| Repetition-loop detector | `apps/web/src/lib/ai.ts` | `packages/ai/src/loop.ts` |
| Caption pipeline (Overseer) | inline in `apps/web/src/lib/agent.ts` | `packages/ai/src/caption.ts` |
| Public surface | inline | `packages/ai/src/index.ts` |

`@huggingface/transformers` becomes a `peerDependency`.

## Public contract

```ts
import { runChat, runVisionCaption, detectRepetitionLoop } from "@overwatch/ai";
```

Names and signatures preserved verbatim so consumer churn is zero.

## Done-when

- `packages/ai/src/index.ts` re-exports `runChat`, `runVisionCaption`,
  `detectRepetitionLoop`, plus the model-id constants.
- No file in `packages/ai/` imports `document`, `window`, or any
  `apps/web` path.
- `apps/web/src/lib/ai.test.ts` (5 cases) moves with the code and
  still passes.
- `packages/ai/README.md` placeholder banner removed.
- `pnpm verify` green; `pnpm drift` green.

## Risks

- Tests historically run in `vitest` with jsdom. The VLM/LLM paths
  are not unit-testable without mocks; only `detectRepetitionLoop`
  has real coverage. Don't add fake coverage to feel safer — call
  out in `TESTS.md` what is and isn't exercised.
