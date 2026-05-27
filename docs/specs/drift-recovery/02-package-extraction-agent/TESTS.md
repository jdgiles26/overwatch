# 02 — `@overwatch/agent` · TDD checklist

- [ ] `packages/agent/src/index.ts` exports `runOverseer`.
- [ ] `packages/agent/src/index.ts` exports `parseAction`, `extractThought`.
- [ ] `packages/agent/src/index.ts` exports types `AgentAction`, `AgentHost`.
- [ ] All 14 cases in the migrated `parseAction` test suite pass.
- [ ] All 4 cases in the migrated `extractThought` test suite pass.
- [ ] `packages/agent/src/overseer.ts` has zero imports from `document`,
      `window`, `html-to-image`, or any `apps/web` module.
- [ ] `apps/web/src/lib/agent.ts` (or its replacement) imports
      `runOverseer` from `@overwatch/agent` and constructs a
      `BrowserAgentHost`.
- [ ] `apps/web/package.json` lists `@overwatch/agent` in `dependencies`.
- [ ] `packages/agent/README.md` no longer says `**Status:** placeholder`.
- [ ] `pnpm --filter @overwatch/agent test` exits 0.
- [ ] `pnpm verify` exits 0 (typecheck + lint + drift across all workspaces).
