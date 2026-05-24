# @overwatch/agent

**Status:** placeholder — reserved for the autonomous Overseer agent.

## Planned scope

The Overseer agent that screenshots the page, captions it via an
`image-to-text` model, reasons over a DOM outline of `data-agent`-tagged
elements, and dispatches a whitelisted set of actions (`click`, `flyTo`,
`setView`, `toggleNightVision`, `navigate`, `say`, `stop`).

## Where the code currently lives

| Concern | Current location |
|---|---|
| Agent loop, action dispatch, DOM outliner | `apps/web/src/lib/agent.ts` |
| Action whitelist + types | inline in the same file |
| Caption + reasoning model wiring | currently calls into `apps/web/src/lib/ai.ts` |

## Extraction plan

1. Move `agent.ts` to `packages/agent/src/overseer.ts` and re-export from
   `src/index.ts`.
2. Replace direct DOM-side imports with a small adapter interface
   (`AgentHost` with `screenshot()`, `outline()`, `dispatch(action)`)
   passed in at construction.
3. Keep `data-agent` attribute conventions documented here so the host
   app can stay in sync.
4. Update `apps/web/src/components/AnalystPanel.tsx` (or wherever
   Overseer is currently instantiated) to construct an `AgentHost`
   adapter and pass it in.

## Blockers

- Tight coupling to browser DOM (`document.querySelector`, screenshot
  via `html-to-image`). Adapter interface lifts this.
- Depends on `@overwatch/ai` (also a placeholder today) for reasoning.
  Extract `@overwatch/ai` first, then this package.

## Dependencies (planned)

- `@overwatch/schemas` — shared action / event types
- `@overwatch/ai` — caption + reasoning models (peer)
