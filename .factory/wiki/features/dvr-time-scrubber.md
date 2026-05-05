# DVR / time scrubber

A small floating control that replaces the live event stream with a sliding historical window. When a window is set, all three viewers — Intel Feed, Map3D, Map2D — re-filter to events whose `occurredAt` falls inside it. When the window is cleared, the app returns to "live" and renders every event in the store.

## Surface area

| Concern | File |
|---|---|
| UI | `apps/web/src/components/TimeScrubber.tsx` |
| Store key | `apps/web/src/lib/store.ts` (`timeWindow`, `setTimeWindow`) |
| Filter helper | `apps/web/src/lib/store.ts` (`applyFilter`) |
| Consumers | `apps/web/src/components/IntelFeed.tsx`, `apps/web/src/components/Map3D.tsx`, `apps/web/src/components/Map2D.tsx` |
| Command Palette hooks | `apps/web/src/components/CommandPalette.tsx` |

## Store shape

`apps/web/src/lib/store.ts`:

```ts
type Store = {
  // …
  timeWindow: { from: number; to: number } | null; // null = live
  setTimeWindow: (w: { from: number; to: number } | null) => void;
};
```

`from` and `to` are Unix milliseconds. The Zustand setter is intentionally untyped beyond that — there is no validation that `from < to` and no clamping to `now`. The DVR component is the only producer.

## `applyFilter` and the time gate

The same helper is used by every viewer and by the Command Palette's "high only" / "clear filters" wiring:

```ts
export function applyFilter(
  events: IngestEvent[],
  f: FilterState,
  timeWindow?: { from: number; to: number } | null,
): IngestEvent[] {
  const q = f.query.trim().toLowerCase();
  return events.filter((e) => {
    if (timeWindow) {
      const t = new Date(e.occurredAt).getTime();
      if (!Number.isFinite(t)) return false;
      if (t < timeWindow.from || t > timeWindow.to) return false;
    }
    if (f.categories.size && !f.categories.has(e.category)) return false;
    if (f.severities.size && !f.severities.has(e.severity)) return false;
    if (q) {
      const hay = `${e.title} ${e.summary ?? ""} ${e.geoMentioned ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
```

Two details matter:

- The gate compares `event.occurredAt`, **not** `receivedAt`. An event that fires at 14:00 but lands in the database at 14:08 (delayed feed) still counts as 14:00. Connectors that don't expose a true timestamp populate `occurredAt` with `new Date().toISOString()` at emit time.
- An invalid date (e.g. a malformed string from a connector) returns `NaN`, which makes `Number.isFinite(t)` fail, and the event is dropped.

## TimeScrubber UI

`apps/web/src/components/TimeScrubber.tsx`. Rendered absolutely-positioned at the bottom-centre of the map area inside `MapView`'s relative container. Two states:

```ts
const PRESETS = [
  { label: "15m", ms: 15 * 60_000 },
  { label: "1h", ms: 60 * 60_000 },
  { label: "6h", ms: 6 * 60 * 60_000 },
  { label: "24h", ms: 24 * 60 * 60_000 },
];
```

Two pieces of local component state:

```ts
const [span, setSpan] = useState(60 * 60_000); // 1h default window width
const [pos, setPos] = useState(1);              // 0..1, 1 = "now"
```

The `applyDvr(p, s)` helper computes the window centre as a linear blend across the last 24 hours:

```ts
function applyDvr(p = pos, s = span) {
  const now = Date.now();
  const earliest = now - 24 * 60 * 60_000;
  const latest = now;
  const center = earliest + p * (latest - earliest);
  setWin({ from: center - s / 2, to: center + s / 2 });
}
```

So the slider's domain is fixed at "the last 24 hours". `pos = 0` centers the window at `now - 24h`; `pos = 1` centers it at `now`. The window itself is symmetric (`center ± span/2`), which means at `pos = 1` half the window extends into the future. That's fine because no events have `occurredAt > now` in practice, and `applyFilter` would simply drop any that did.

### LIVE state

When `timeWindow === null`, the component shows a green `LIVE` indicator and a single button:

```tsx
<button data-agent="dvr-rewind" onClick={() => { setPos(1); applyDvr(1, span); }}>
  <Rewind className="h-3 w-3 inline" /> Replay last hour
</button>
```

Click it and `applyDvr(1, 1h)` runs, which writes `{ from: now - 30min, to: now + 30min }`. The component re-renders into DVR state.

### DVR state

When `timeWindow !== null`, the component renders:

- A pause icon and the text `DVR · {fromTime} → {toTime}` in `toLocaleTimeString()` form.
- A 0–1000 range input wired to `pos`. Each `onChange` calls `applyDvr(p)` so dragging is interactive.
- A `<select>` of the four `PRESETS` mapped onto the `span` state. Changing it calls `applyDvr(undefined, s)` so the window width changes around the same centre.
- A "Live" button with `data-agent="dvr-live"` that calls `setWin(null)`. The component re-renders into LIVE state.

Both buttons are tagged for the Overseer (`data-agent="dvr-rewind"`, `data-agent="dvr-live"`), and the entire bar is `data-agent="time-scrubber"`.

## Consumers

### `apps/web/src/components/IntelFeed.tsx`

```ts
const filtered = useMemo(
  () => applyFilter(events, filter, timeWindow),
  [events, filter, timeWindow],
);
```

The Intel Feed list is `filtered.slice(0, 400).map(...)`. As soon as `timeWindow` changes, `useMemo` re-runs and the visible cards update. The empty-state (`No events yet. Connect data sources →`) doubles as the empty-state for an over-restrictive DVR window.

### `apps/web/src/components/Map3D.tsx`

```ts
const visibleEvents = useMemo(
  () =>
    applyFilter(events, filter, timeWindow)
      .filter((e) => e.geo)
      .slice(0, 1500),
  [events, filter, timeWindow],
);
```

The downstream `useEffect` diffs `entitiesRef.current` against `visibleEvents` and removes Cesium entities for events that no longer pass the filter. The 3D globe therefore "rewinds" by removing entities that fall outside the window and re-adding ones that fall inside it.

The aircraft trails (see [features/aircraft-trails](./aircraft-trails.md)) are computed from the **unfiltered** `events` array, so trails are not time-gated. A maintainer who wants DVR-aware trails would need to thread `applyFilter` into the `aircraftTrails` `useMemo`.

### `apps/web/src/components/Map2D.tsx`

```ts
const features = useMemo(() => {
  const fs = applyFilter(events, filter, timeWindow)
    .filter((e) => e.geo)
    .slice(0, 1500)
    .map(e => ({ /* … GeoJSON Feature … */ }));
  return { type: "FeatureCollection" as const, features: fs };
}, [events, filter, timeWindow]);
```

A subsequent `useEffect` watches `features` and calls `src?.setData(features)` on the `events` GeoJSON source. Both the heatmap layer and the circle layer redraw. The location markers are not filtered.

## Command Palette wiring

`apps/web/src/components/CommandPalette.tsx` exposes two DVR commands:

- `live` → `() => useStore.getState().setTimeWindow(null)`. Returns to live mode regardless of current state.
- `replay` → presets the window to the last hour: `setTimeWindow({ from: now - 3600000, to: now })`. This bypasses `applyDvr` and writes the window directly.

## End-to-end example

1. User presses `Cmd+K` and runs **"Replay last hour"**. The store writes `timeWindow = { from: now - 1h, to: now }`.
2. `IntelFeed`, `Map3D`, and `Map2D` all re-memoise. Events whose `occurredAt > now - 1h` remain visible; everything older drops out.
3. New live events still arrive over the WebSocket and are added to the store via `addEvent`. They will show in the rewound view *if and only if* their `occurredAt` falls inside the window — which they do as long as `to >= now`.
4. The user drags the time scrubber slider to `pos = 0.5`. `applyDvr(0.5)` rewrites the window to `{ from: now - 12h - 30m, to: now - 12h + 30m }`. The map redraws with events from 12 h ago.
5. The user clicks **Live**. `setTimeWindow(null)`. Every store event becomes visible again, capped at the 2,000-event store limit.

## Limits worth knowing

- **The window's domain is fixed at 24 hours.** Events older than 24 hours can only be reached by SQL — `recentEvents(2000)` on the fabric or `GET /api/events?limit=2000` from the browser. The slider physically cannot represent older windows because `earliest = now - 24h` is hard-coded.
- **The store caps `events` at 2,000.** If a heavy day fills the store before the user rewinds, older events have already been evicted from memory. The fabric still has them; the browser does not.
- **Aircraft trails ignore the window.** Trails are computed from `events` (unfiltered) inside `Map3D.tsx`, so the trail polylines persist even when the corresponding event dots are time-gated out.
- **No "play"/"step" controls.** The DVR is a static window; advancing time means dragging the slider or returning to live.
- **The window centre and span are not persisted.** Reloading the page resets to LIVE and `span = 1h`.

## Related pages

- [apps/web § IntelFeed / MapView](../apps/web.md) — the three viewers consuming `timeWindow`.
- [features/command-palette](./command-palette.md) — the `live` and `replay` shortcuts.
- [features/aircraft-trails](./aircraft-trails.md) — note that trails are not DVR-filtered.
- [overview/glossary](../overview/glossary.md) — "Time window / DVR".
