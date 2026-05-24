# @overwatch/ui

**Status:** placeholder — reserved for shared React UI components.

## Planned scope

The reusable dashboard components: tactical chrome, panels, map
shells, camera strip, command palette, and time scrubber. Anything
that could plausibly be consumed by a second app (mobile, embed,
demo page) without dragging the Zustand store along.

## Where the code currently lives

All in `apps/web/src/components/`:

| Component | Concern |
|---|---|
| `TopBar.tsx` | Status bar, threatcon indicator |
| `CommandPalette.tsx` | ⌘K command palette |
| `Map3D.tsx`, `Map2D.tsx`, `MapView.tsx` | Cesium / MapLibre map shells |
| `CameraStrip.tsx`, `CameraTile.tsx` | Camera feed strip + tile |
| `AnalystPanel.tsx` | Analyst chat panel |
| `OverseerPanel.tsx` | Overseer agent panel |
| `AssessmentPanel.tsx`, `IntelFeed.tsx`, `EventDetail.tsx` | Intel feed + assessment |
| `DroneDetailPanel.tsx`, `DroneTrackLayer.tsx` | Drone track UI |
| `ConsoleFilter.tsx`, `TimeScrubber.tsx` | Console + timeline scrubber |
| `PwaRegister.tsx` | PWA service-worker registration |

## Extraction plan (in order of effort)

1. **Easiest first — pure presentational:** `TopBar`, `EventDetail`,
   `ConsoleFilter`, `TimeScrubber`. These take props and emit
   callbacks; lift them out with no store coupling.
2. **Medium — store-coupled but isolatable:** `CommandPalette`,
   `AnalystPanel`, `OverseerPanel`. Convert store reads to props.
3. **Hardest — wired to external SDKs:** `Map3D`/`Map2D`/`MapView`
   (Cesium + MapLibre), `CameraStrip`/`CameraTile` (HLS.js,
   getUserMedia, vision-engine fan-out).
4. `PwaRegister` likely stays in `apps/web` (Next.js specific).

## Blockers

- All components currently read directly from the Zustand store
  (`apps/web/src/lib/store.ts`). Extraction = convert each component
  to take props, then route store wiring through a thin wrapper in
  `apps/web`.
- Tailwind classes assume the app's `tailwind.config.ts`; the
  extracted package will need its own preset or rely on the host
  app's config (preferred).
- Some components depend on `@overwatch/cv` (also placeholder) for
  worker types. Extract `@overwatch/cv` first.

## Dependencies (planned)

- `react` (peer)
- `clsx`, `tailwind-merge` (utility)
- `lucide-react` (icons)
- `@overwatch/schemas` (peer — domain types)
