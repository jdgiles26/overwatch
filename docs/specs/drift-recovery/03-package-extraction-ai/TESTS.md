# 03 — `@overwatch/ai` · TDD checklist

- [ ] `packages/ai/src/index.ts` exports `runChat`, `runVisionCaption`,
      `detectRepetitionLoop`.
- [ ] All 5 cases in the migrated `ai.test.ts` (`detectRepetitionLoop`)
      pass under `pnpm --filter @overwatch/ai test`.
- [ ] No file in `packages/ai/src/` imports `document`, `window`, or
      from `apps/web/*`.
- [ ] `apps/web` imports come from `@overwatch/ai` (grep:
      `from "@overwatch/ai"` count > 0 in `apps/web/src/`).
- [ ] `apps/web/src/lib/ai.ts` is deleted or reduced to a re-export shim.
- [ ] `packages/ai/README.md` placeholder banner removed.

**Explicit non-coverage** (call out, don't fake):

- WebGPU paths are not exercised by tests anywhere in the repo. They
  rely on manual browser smoke. The E2E spec (08) closes this loop.
- VLM / caption pipelines are not unit-testable without `transformers`
  mocks; defer that decision to the implementing agent.
