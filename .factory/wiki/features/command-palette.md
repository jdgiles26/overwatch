# Command palette

A `Cmd+K` (or `Ctrl+K`) modal that exposes the dashboard's most-used actions as keyboard-navigable commands. The palette is one component, ~150 lines, with no third-party command-palette library — it's a hand-rolled `<input>` plus a substring filter over a dynamic command list.

## Surface area

| Concern | File |
|---|---|
| UI + commands | `apps/web/src/components/CommandPalette.tsx` |
| Mounted in | `apps/web/src/app/page.tsx` |

## Toggle

```ts
useEffect(() => {
  function onKey(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      setOpen((x) => !x);
    } else if (e.key === "Escape" && open) {
      setOpen(false);
    }
  }
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [open]);
```

- **Cmd+K** on macOS, **Ctrl+K** on everything else. The same chord toggles between open and closed.
- **`e.preventDefault()`** stops Chrome from focusing the URL bar (its default Cmd+K binding).
- **`Escape`** closes the modal but only when it's already open. The two-condition guard avoids stealing Escape from other modals when the palette is dormant.

The palette also closes when the user clicks the dim background. The inner panel calls `e.stopPropagation()` so clicks on the input or list don't bubble up:

```tsx
<div className="fixed inset-0 ..." onClick={() => setOpen(false)}>
  <div className="panel ..." onClick={(e) => e.stopPropagation()}>
    {/* ... */}
  </div>
</div>
```

## The command list

Built inside a `useMemo` so it re-runs whenever the live event store changes (the `flyTopEvent` label depends on the current top event):

```ts
const cmds: Cmd[] = useMemo(() => {
  const sevRank: Record<string, number> = {
    extreme: 4, high: 3, moderate: 2, low: 1, info: 0,
  };
  const top = [...events]
    .filter((e) => e.geo)
    .sort((a, b) => (sevRank[b.severity] ?? 0) - (sevRank[a.severity] ?? 0))[0];
  return [
    { id: "view-3d", label: "Switch to 3D globe", run: () => setView("map3d") },
    { id: "view-2d", label: "Switch to 2D map", run: () => setView("map2d") },
    { id: "view-split", label: "Split view (3D + 2D)", run: () => setView("split") },
    { id: "night", label: "Toggle night vision", run: () => setNight(!useStore.getState().nightVision) },
    { id: "analyst", label: "Open Analyst", run: () => setAnalyst(true) },
    { id: "overseer", label: "Open Overseer", run: () => setOverseer(true) },
    { id: "rules", label: "Manage alert rules", run: () => router.push("/rules") },
    { id: "connectors", label: "Manage connectors", run: () => router.push("/connectors") },
    { id: "live", label: "DVR · go live", run: () => setWindow(null) },
    {
      id: "replay",
      label: "DVR · replay last hour",
      run: () => setWindow({ from: Date.now() - 60 * 60_000, to: Date.now() }),
    },
    {
      id: "flyTopEvent",
      label: top ? `Fly to: ${top.title}` : "Fly to top event",
      hint: top?.severity,
      run: () => { if (top?.geo) requestFly({ lat: top.geo.lat, lon: top.geo.lon, zoom: 7 }); },
    },
    {
      id: "highOnly",
      label: "Filter: only high+extreme",
      run: () => { clearFilters(); toggleSev("high"); toggleSev("extreme"); },
    },
    { id: "clearFilter", label: "Filter: clear all", run: clearFilters },
  ];
}, [events, setView, setNight, setAnalyst, setOverseer, setWindow, requestFly, clearFilters, toggleSev, router]);
```

Thirteen commands, grouped logically:

| Group | Commands |
|---|---|
| View | `view-3d`, `view-2d`, `view-split` |
| Theme | `night` |
| Panels | `analyst`, `overseer` |
| Navigation | `rules`, `connectors` |
| DVR | `live`, `replay` |
| Map | `flyTopEvent` |
| Filters | `highOnly`, `clearFilter` |

Each command is a `{ id, label, run, hint? }`. The `hint` is a small grey label rendered to the right of the row; today only `flyTopEvent` uses it (to show the severity of the highest event).

### Top-event sort

The `flyTopEvent` command computes its target on every keystroke (the memo depends on `events`):

```ts
const top = [...events]
  .filter((e) => e.geo)
  .sort((a, b) => (sevRank[b.severity] ?? 0) - (sevRank[a.severity] ?? 0))[0];
```

The sort is by severity rank only — ties are broken by the original array order, which is reverse-chronological (most recent first) because `events` are prepended in `addEvent`. So when several events share `extreme`, the most recent extreme wins.

If no event has `geo`, the label falls back to `"Fly to top event"` (no preview) and `run` becomes a no-op (`if (top?.geo)` short-circuits).

## Substring filter

```ts
const filtered = useMemo(() => {
  const t = q.trim().toLowerCase();
  if (!t) return cmds;
  return cmds.filter((c) => c.label.toLowerCase().includes(t));
}, [cmds, q]);
```

Plain case-insensitive substring match against `label`. There is no fuzzy match, no scoring, no reordering. "rep" finds "DVR · replay last hour"; "tope" finds "Fly to: ..." (because "top event" is in the fallback label, but only when there is no live top event).

## Enter / click

The first match runs on Enter:

```tsx
<input
  autoFocus
  className="input"
  placeholder="Type a command..."
  value={q}
  onChange={(e) => setQ(e.target.value)}
  onKeyDown={(e) => {
    if (e.key === "Enter") {
      filtered[0]?.run();
      setOpen(false);
    }
  }}
/>
```

There is no up/down arrow navigation. The user can only click a row (which also closes the palette) or press Enter to fire the first match. With a 13-command list and substring search, this is fine in practice.

## End-to-end example

A typical session:

1. User presses `Cmd+K`. The palette opens, focused on the input.
2. Types `repl`. The list narrows to `"DVR · replay last hour"`.
3. Presses Enter. `setWindow({from: now - 1h, to: now})` runs. The palette closes.
4. The Time Scrubber switches to DVR mode. IntelFeed, Map3D, Map2D re-render with last-hour-only events.

Another:

1. `Cmd+K`, type `top`, press Enter.
2. `requestFly({lat, lon, zoom: 7})` fires for the most-severe geolocated event.
3. The Cesium globe flies to the chosen event. The 3D selection sticks for a few frames (the palette doesn't call `selectEvent`, so the event detail flyout doesn't open automatically — that's the Overseer's `flyToTopEvent` action's job).

A subtle one:

1. `Cmd+K`, type `night`, Enter.
2. `setNight(!useStore.getState().nightVision)` toggles the body-level CSS class.
3. The whole UI flips to phosphor-green.

## Limits worth knowing

- **No keyboard navigation.** Up/down arrows do nothing. Tab moves browser focus around the palette but the rows are not in tab order.
- **`Cmd+K` is global.** It fires even when an input field elsewhere is focused. For most apps that would be a problem; here the dashboard has very few input fields and stealing the chord is the desired UX.
- **No mouse hover preview.** Rows don't show keyboard shortcuts or descriptions.
- **No "recent commands" memory.** The palette resets to the static list every open.
- **`flyTopEvent` doesn't open EventDetail.** Only the camera flies; the IntelFeed selection state is unchanged.
- **Dynamic top event preview lags by one render.** Because `cmds` is `useMemo`'d on `events`, a new `extreme` event must arrive before the next render to update the label. There's no realtime subscription.
- **No per-command icons.** All rows are text-only.

## Related pages

- [features/dvr-time-scrubber](./dvr-time-scrubber.md) — the `live` and `replay` commands.
- [features/overseer-agent](./overseer-agent.md) — the agent has a similar but separate `flyToTopEvent` action.
- [apps/web § CommandPalette](../apps/web.md#commandpalette) — the surrounding dashboard layout.
