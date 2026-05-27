# 02 — Extract `@overwatch/agent`

## Goal

Move the Overseer agent loop (currently `apps/web/src/lib/agent.ts`)
into the existing `packages/agent/` workspace so it can be unit-tested
without a Next.js bundler and so a second host (mobile, embed, demo)
could consume it.

## Non-goals

- Rewriting the agent. Move-then-improve.
- Changing the action whitelist or DOM-side contract with `data-agent` attrs.
- Decoupling from `@huggingface/transformers` (that's spec 03's job).

## Scope

| Move | From | To |
|---|---|---|
| Agent loop, parser, executor | `apps/web/src/lib/agent.ts` | `packages/agent/src/overseer.ts` |
| Tests | `apps/web/src/lib/agent.test.ts` | `packages/agent/src/overseer.test.ts` |
| Public surface | inline export | `packages/agent/src/index.ts` |

Introduce an `AgentHost` interface:

```ts
export interface AgentHost {
  screenshot(): Promise<Blob>;
  outline(): Promise<string>;            // DOM outline of [data-agent] nodes
  dispatch(action: AgentAction): Promise<void>;
  caption(image: Blob): Promise<string>; // wraps spec-03 caption pipeline
}
```

`apps/web` constructs a `BrowserAgentHost` that wires the existing DOM
implementation; the package itself ships zero DOM imports.

## Public contract

```ts
import { runOverseer, type AgentHost, type AgentAction } from "@overwatch/agent";
const stop = runOverseer({ host, mission: "..." });
// later
stop();
```

All currently-allowed actions (`click`, `flyTo`, `setView`,
`toggleNightVision`, `navigate`, `say`, `stop`) must remain whitelisted
with identical semantics.

## Done-when

- `packages/agent/src/index.ts` exports `runOverseer`, `parseAction`,
  `executeAction` (via host), `extractThought`, plus `AgentAction` and
  `AgentHost` types.
- `apps/web` imports `@overwatch/agent` instead of the local module.
- `packages/agent/README.md` no longer contains the
  `**Status:** placeholder` banner.
- All 14 existing `agent.test.ts` cases pass against the moved code.
- `pnpm drift` `placeholder-packages-not-imported` check remains
  green (i.e. the README banner is gone, so the consumer dependency
  is now legitimate).

## Risks

- Browser-only code paths (`document.querySelector`, `html-to-image`)
  must be lifted into `BrowserAgentHost`, not imported in the package.
  The `AgentHost` interface is the seam.
- `@overwatch/ai` is also a placeholder. Either extract it first or
  let the host supply `caption()` from `apps/web/src/lib/ai.ts` for now.
