# 05 — Extract `@overwatch/ui`

## Goal

Lift the presentation-layer React components into `packages/ui/` so a
second host (mobile shell, embed page, demo site) can consume them
without dragging the Zustand store along.

## Non-goals

- Storybook (separate spec if/when needed).
- Theming or design tokens (defer until consumer exists).
- Touching the Zustand store itself.

## Scope (in extraction order — easiest first)

| Phase | Components |
|---|---|
| 1 — pure presentational | `TopBar`, `EventDetail`, `ConsoleFilter`, `TimeScrubber` |
| 2 — store-coupled but isolatable (props in, callbacks out) | `CommandPalette`, `AnalystPanel`, `OverseerPanel` |
| 3 — SDK-coupled (Cesium, MapLibre, HLS.js, getUserMedia) | `Map3D`, `Map2D`, `MapView`, `CameraStrip`, `CameraTile` |

`PwaRegister.tsx` stays in `apps/web` (Next.js-specific).

Each phase ships in its own commit; this spec is "done" when phase 1
is in `@overwatch/ui` and phases 2 & 3 each have a follow-up spec.

## Public contract

```ts
import { TopBar, EventDetail, ConsoleFilter, TimeScrubber } from "@overwatch/ui";
```

Components take props and emit callbacks. No `useStore` imports.

## Done-when

- Phase 1 components live in `packages/ui/src/`.
- `apps/web` imports them from `@overwatch/ui`.
- `packages/ui/README.md` placeholder banner removed.
- A separate follow-up spec exists for phase 2 (`05.2-...`) and phase
  3 (`05.3-...`) — even if empty, the folder marker is sufficient.
- Phase 1 components have at least smoke render tests under jsdom.

## Risks

- React 19 + jsdom; some components use refs or portals. Render tests
  may need `@testing-library/react` or a thin shim. Pick once.
