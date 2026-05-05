# Aircraft trails

OpenSky's ADS-B feed emits one event per aircraft per poll. Each event carries the aircraft's ICAO24 hex code in `payload.icao24`. The 3D map buckets these by ICAO24, sorts by time, and draws the last 12 positions as a polyline. The EventDetail flyout exposes a "Follow aircraft" button that locks the camera onto the most recent position as new pings arrive.

## Surface area

| Concern | File |
|---|---|
| Connector emission | `packages/connectors/src/sources/opensky.ts` |
| Trail computation + render | `apps/web/src/components/Map3D.tsx` |
| Follow button | `apps/web/src/components/EventDetail.tsx` |
| Store key | `apps/web/src/lib/store.ts` (`followEntity`, `setFollowEntity`) |

## OpenSky connector

`packages/connectors/src/sources/opensky.ts` polls `https://opensky-network.org/api/states/all?lamin=...&lomin=...&lamax=...&lomax=...` every 20 seconds and emits one event per aircraft state vector:

```ts
for (const s of data.states ?? []) {
  const [icao24, callsign, , , , lon, lat, , , vel, hdg, , , altGeo] = s;
  if (lat == null || lon == null) continue;
  ctx.emit({
    id: `flight-${icao24}-${data.time}`,
    category: "transport",
    severity: "info",
    title: `${(callsign ?? "").trim() || icao24}`,
    summary: `Heading ${Math.round(hdg ?? 0)}° at ${Math.round(((vel ?? 0) * 3.6))} km/h`,
    occurredAt: new Date(data.time * 1000).toISOString(),
    geo: { lat, lon, alt: altGeo ?? 0 },
    icon: "plane",
    payload: { icao24, callsign, velocity: vel, heading: hdg, altitude: altGeo },
  });
}
```

Notes that matter downstream:

- **`payload.icao24`** is the bucketing key everywhere else in the app. It's the lower-case hex code from OpenSky.
- **`payload.callsign`** is sometimes blank; the title falls back to the ICAO24.
- **`payload.heading`, `velocity`, `altitude`** are emitted but not currently used by the trail renderer (a future glyph could rotate to heading).
- **`id`** uses `data.time` (the poll's epoch seconds) so two pings 1 second apart have different IDs and both persist; the trail therefore reflects all observed positions.
- **`severity: "info"`** — OpenSky events are deliberately quiet. They won't push THREATCON or trip alert rules unless the user explicitly targets `category: "transport"`.

The default bbox is `[-125, 24, -66, 50]` — continental US.

## Trail computation

`apps/web/src/components/Map3D.tsx`:

```ts
const aircraftTrails = useMemo(() => {
  const byIcao = new Map<string, IngestEvent[]>();
  for (const e of events) {
    if (!e.geo) continue;
    const id = e.payload?.icao24;
    if (!id) continue;
    const arr = byIcao.get(id) ?? [];
    arr.push(e);
    byIcao.set(id, arr);
  }
  const trails: { id: string; path: [number, number][] }[] = [];
  for (const [id, arr] of byIcao) {
    if (arr.length < 2) continue;
    arr.sort(
      (a, b) =>
        new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    );
    const path = arr
      .slice(-12)
      .map((e) => [e.geo!.lon, e.geo!.lat] as [number, number]);
    trails.push({ id, path });
  }
  return trails.slice(0, 30);
}, [events]);
```

Properties:

- **Bucketed by `payload.icao24`.** Events without an ICAO24 are skipped — only OpenSky events qualify today.
- **Minimum 2 positions.** A single ping doesn't make a trail.
- **Sort by `occurredAt`.** OpenSky events arrive in upstream order, but a delayed poll could land out of order. Sorting ensures the polyline is monotonically time-ordered.
- **Last 12 positions.** Older pings drop off the end. With a 20 s poll, 12 positions cover roughly 4 minutes of flight.
- **Cap at 30 trails.** A continental US poll can return 200+ aircraft; rendering 200 polylines tanks frame rate. The first 30 (in `Map<string,>` insertion order) survive.
- **Computed from the unfiltered `events` array.** The filter and the time scrubber do not affect trails. See [features/dvr-time-scrubber](./dvr-time-scrubber.md).

## Cesium polyline sync

The same `useEffect` that diffs event entities also diffs trails:

```ts
const trailIds = new Set(aircraftTrails.map((t) => `trail-${t.id}`));
for (const [tid, ent] of trailsRef.current) {
  if (!trailIds.has(tid)) {
    viewer.entities.remove(ent);
    trailsRef.current.delete(tid);
  }
}
for (const t of aircraftTrails) {
  const tid = `trail-${t.id}`;
  const positions = Cesium.Cartesian3.fromDegreesArray(
    t.path.flatMap((p) => p),
  );
  const existing = trailsRef.current.get(tid);
  if (existing) {
    existing.polyline.positions = positions;
    continue;
  }
  const ent = viewer.entities.add({
    id: tid,
    polyline: {
      positions,
      width: 2,
      material: Cesium.Color.fromCssColorString("#5cf0c9").withAlpha(0.55),
      clampToGround: false,
    },
  });
  trailsRef.current.set(tid, ent);
}
```

Properties:

- **Entity ID is `trail-${icao24}`** so re-renders update the same Cesium entity instead of recreating it. Updating `existing.polyline.positions` in place is dramatically cheaper than `entities.remove + entities.add`.
- **`Cesium.Cartesian3.fromDegreesArray(t.path.flatMap(p => p))`** — flattens `[[lon,lat],[lon,lat],...]` to `[lon,lat,lon,lat,...]` because Cesium's helper expects a flat array.
- **`width: 2`** — slightly heavier than 1 px to read on a busy globe.
- **`#5cf0c9` at alpha 0.55** — the accent green used elsewhere, half-transparent so overlapping trails don't paint over each other to opacity.
- **`clampToGround: false`** — trails float at altitude 0. The connector emits `alt: altGeo ?? 0` but that altitude is in metres above WGS84; using it would draw the trail at flight level, often above the camera frustum at default zoom. The current choice "draws on the surface" reads better at globe scale.

## Follow aircraft

The `EventDetail.tsx` flyout shows a "Follow aircraft" button only when the event has `payload.icao24`:

```tsx
{ev.payload?.icao24 && (
  <div className="mb-2 flex items-center gap-2 text-[11px]">
    <span className="rounded bg-white/5 px-1.5">
      <Plane className="mr-1 inline h-3 w-3" />
      {ev.payload.callsign?.trim?.() || ev.payload.icao24}
    </span>
    <button
      className="btn"
      onClick={() => followEntity({ kind: "icao24", value: ev.payload!.icao24 })}
    >
      Follow aircraft
    </button>
  </div>
)}
```

The store key is:

```ts
followEntity: { kind: "icao24" | "id"; value: string } | null;
```

So far only `kind: "icao24"` is used. The `"id"` kind is reserved for following arbitrary events.

`Map3D.tsx` watches `followEntity` and the events array:

```ts
useEffect(() => {
  if (!followEntity || followEntity.kind !== "icao24") return;
  const recent = events.find(
    (e) => e.payload?.icao24 === followEntity.value && e.geo,
  );
  if (!recent || !recent.geo || !viewerRef.current) return;
  (async () => {
    const Cesium = await import("cesium");
    viewerRef.current.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        recent.geo!.lon,
        recent.geo!.lat,
        200_000,
      ),
      duration: 1.0,
    });
  })();
}, [followEntity, events]);
```

Properties:

- **`events.find` returns the *first* matching event.** Because `addEvent` prepends new events to the array, `find` returns the **most recent** ping for that ICAO24. So whenever a fresh OpenSky poll lands a ping for the followed aircraft, the camera flies again.
- **Camera height = 200 km.** A close-but-not-too-close zoom that keeps several hundred kilometres of context visible.
- **`duration: 1.0`** — one-second smooth fly. Successive pings 20 s apart blend smoothly.
- **No "stop following" UI.** To stop, the user has to either close and reopen the EventDetail (which doesn't reset `followEntity`), or trigger a different `flyTo` from elsewhere (the camera then rebases). A maintainer who wanted an "unfollow" affordance could call `setFollowEntity(null)` from the EventDetail flyout.

## End-to-end timing

1. The OpenSky connector polls and emits 137 aircraft events. One of them has `payload.icao24 = "a1b2c3"`, callsign `"UAL2451"`.
2. The orchestrator persists each event and broadcasts. The browser's store fills.
3. `Map3D.tsx` re-memoises `aircraftTrails`. UAL2451 is one of 137 ICAO24 buckets but only the first 30 aircraft (by Map insertion order) get rendered. UAL2451 is included; its trail has a single point so it's filtered out (`if (arr.length < 2) continue;`).
4. 20 seconds later, the next poll lands. UAL2451's bucket now has 2 positions. The trail renders as a 2-vertex polyline in accent green.
5. The user clicks the UAL2451 dot. EventDetail opens. They click **Follow aircraft**.
6. `setFollowEntity({kind:"icao24", value:"a1b2c3"})` writes to the store.
7. `Map3D`'s `useEffect` fires, finds the freshest event for that ICAO24, flies the camera to `(lat, lon, 200_000m)`.
8. 20 seconds later, a new ping arrives. `events` changes. The `useEffect` fires again with the new `recent` event. Camera flies again. The polyline grows to 3 vertices.
9. After 12 pings (4 minutes), the trail starts dropping the oldest position from the head as new ones arrive at the tail.

## Limits worth knowing

- **`severity: "info"`** for OpenSky means alert rules with `minSeverity: "low"` or higher won't fire on aircraft. To get an alert for a specific tail number, drop `minSeverity` and use `keywords: ["UAL2451"]`.
- **The 30-trail cap is FIFO by Map insertion order**, not by interestingness. A contended demo with many planes might omit the one the user cares about. The fix is to filter by callsign or bbox in the connector config.
- **No altitude rendering.** Trails are drawn at the surface; a high-altitude flight and a low-altitude flight look identical.
- **Trails are not DVR-aware.** Setting a 1-hour replay window doesn't trim the trails to that window. Trails always show the last 12 positions across all stored events.
- **Following an aircraft cannot be cancelled from the UI.** `followEntity` is only mutated by the EventDetail button. Closing the panel doesn't clear it.
- **No predicted track.** The polyline only draws observed positions; there is no extrapolation forward.
- **The connector's bbox limits coverage.** The default `[-125, 24, -66, 50]` covers continental US. Trails for aircraft over Europe simply don't exist unless the user widens the bbox in connector config.

## Related pages

- [packages/connectors § opensky](../packages/connectors.md) — the upstream feed.
- [apps/web § Map3D](../apps/web.md#map3d-cesium-globe) — the Cesium globe that renders the polylines.
- [features/dvr-time-scrubber](./dvr-time-scrubber.md) — note that trails are not gated by `timeWindow`.
- [overview/glossary](../overview/glossary.md) — "Follow entity".
