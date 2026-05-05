# THREATCON & PIR

A small, deterministic scoring engine that turns the running event stream into one number (THREATCON, 0–10) and six yes/no answers (Priority Intelligence Requirements). Both are recomputed every 15 seconds on the fabric and broadcast over WebSocket. The browser shows them in `apps/web/src/components/AssessmentPanel.tsx`.

## Surface area

| Concern | File |
|---|---|
| Algorithm | `apps/fabric/src/threatcon.ts` (`computeThreatcon`, `computePIR`) |
| 15 s broadcast loop | `apps/fabric/src/index.ts` (`startThreatLoop`) |
| HTTP endpoint | `apps/fabric/src/index.ts` (`GET /api/threatcon`) |
| Schemas | `packages/schemas/src/index.ts` (`ThreatCon`, `PIR`) |
| UI | `apps/web/src/components/AssessmentPanel.tsx` |

## THREATCON formula

Code (`apps/fabric/src/threatcon.ts`):

```ts
export function computeThreatcon(events: IngestEvent[], locations: Location[]): ThreatCon {
  let score = 0;
  const reasons: string[] = [];
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  const recent = events.filter((e) => new Date(e.receivedAt).getTime() > cutoff);

  const sev = (s: string): number =>
    (({ info: 0, low: 1, moderate: 2, high: 3, extreme: 4 } as Record<string, number>)[s] ?? 0);

  for (const loc of locations) {
    for (const e of recent) {
      if (!e.geo) continue;
      const d = km(loc.geo, e.geo);
      if (d <= loc.radiusKm) {
        const s = sev(e.severity);
        if (s >= 2) {
          score += s * 0.7;
          if (reasons.length < 8) reasons.push(`${e.title} (${d.toFixed(0)} km from ${loc.label})`);
        }
      }
    }
  }

  for (const e of recent) {
    if (e.severity === "extreme") score += 1;
    else if (e.severity === "high") score += 0.3;
  }

  score = Math.min(10, score);
  const level: ThreatCon["level"] =
    score >= 8 ? "critical" : score >= 6 ? "high" : score >= 4 ? "elevated" : score >= 2 ? "guarded" : "nominal";

  return {
    score: Math.round(score * 10) / 10,
    level,
    reasons: reasons.slice(0, 6),
    computedAt: new Date().toISOString(),
  };
}
```

Properties to memorise:

- **Recency cutoff = 6 hours.** Anything older than `now - 6h` (by `receivedAt`, not `occurredAt`) is excluded.
- **Per-event proximity weight = `severity * 0.7`** for events within a saved Location's `radiusKm`. Severity is the numeric rank `info=0, low=1, moderate=2, high=3, extreme=4`. Events with severity `info` or `low` (rank < 2) contribute zero to the proximity term.
- **Global severity boost = `+1 per extreme, +0.3 per high`** event in the 6 h window. This term ignores geometry — a global earthquake counts even if you have no Locations configured.
- **Saturation at 10.** `score = Math.min(10, score)`.
- **Rounded to 1 decimal place** for display.
- **Level bands** (inclusive lower bound):
  - `>= 8` → `critical`
  - `>= 6` → `high`
  - `>= 4` → `elevated`
  - `>= 2` → `guarded`
  - else → `nominal`
- **Reasons cap = top 6.** Reasons are only added inside the proximity loop, so a system with no `locations` configured will return an empty `reasons` array even at THREATCON 10. The internal `if (reasons.length < 8)` guard is a soft cap that never matters because the outer slice is at 6.
- **`computedAt`** is set fresh on every call.

The score does *not* normalise by the number of events. With many connectors enabled, even a quiet day can stack to elevated through volume alone; this is by design.

## PIR predicates

Six fixed PIRs, all in `apps/fabric/src/threatcon.ts → computePIR`. Two recency windows are built up front: `recent24` (last 24 hours by `receivedAt`) and `recent1` (last 1 hour). The `near(e, radius)` helper returns true if the event has `geo` and there exists a Location within `radius` km using the haversine `km(...)` from `@overwatch/connectors`.

| ID | Question | Predicate |
|---|---|---|
| `weather-25km` | "Severe weather within 25 miles?" | A `weather` event in the last 24 h with `severity ∈ {high, extreme}` AND `near(e, 40)` km. |
| `quake-200km` | "Earthquake M4+ within 200 km in the last 24h?" | A `seismic` event in the last 24 h with `payload.mag >= 4` AND `near(e, 200)`. |
| `fire-nearby` | "Active wildfire within 100 km?" | A `fire` event in the last 24 h with `near(e, 100)`. |
| `aqi-poor` | "Poor air quality (PM2.5>35) near a location?" | An `air` event in the last 24 h with `severity ∈ {moderate, high, extreme}` AND `near(e, 30)`. |
| `iot-breach` | "IoT anomaly flagged in the last hour?" | An `iot` event **in `recent1`** (last 1 h) with `severity ∈ {high, moderate}`. No geo gate. |
| `cv-alert` | "Computer-vision detector fired in the last hour?" | Any `cv` event **in `recent1`** (last 1 h). No severity gate, no geo gate. |

The detail line on `weather-25km` is hard-coded as `"NWS + Open-Meteo aggregated over the last 24h."`. The other five PIRs leave `detail` undefined.

`evidenceIds` is always `[]` in this implementation — the schema reserves the field but the engine does not currently surface them. Search `evidenceIds` in `packages/schemas/src/index.ts` to confirm.

The answer enum has three values (`yes | no | unknown`), but `computePIR` only ever returns `yes` or `no`. The `unknown` case is reserved for future dependence on a feed that hasn't connected yet.

A subtle quirk: the `aqi-poor` question text mentions "PM2.5>35", but the predicate doesn't actually inspect `payload.pm25`. It relies on the `openaq` connector's own severity mapping. If a different `air` connector is added with looser severity rules, the answer here will follow that connector's convention without any threshold sanity check.

## The 15 s broadcast loop

`apps/fabric/src/index.ts`:

```ts
function startThreatLoop() {
  threatTimer = setInterval(() => {
    const events = recentEvents(1000);
    const locations = listLocations().map((l: any) => ({
      id: l.id, label: l.label, geo: { lat: l.lat, lon: l.lon },
      radiusKm: l.radius_km, kind: l.kind,
    }));
    broadcast({ type: "threatcon", data: computeThreatcon(events, locations) });
    broadcast({ type: "pir", data: computePIR(events, locations) });
  }, 15_000);
}
```

- The window is **the last 1000 events** loaded via `recentEvents(1000)`. With heavy throughput this can be smaller than the `cutoff = now - 6h` filter inside `computeThreatcon`, in which case the older events simply never enter the score.
- Locations are reloaded from SQLite on every tick, so adding a new Location updates THREATCON within 15 s.
- Both `threatcon` and `pir` are broadcast to **every** connected WebSocket client. There is no diffing — a fresh full snapshot is pushed every 15 s.
- A second copy of the same code path is exposed at `GET /api/threatcon` (`apps/fabric/src/index.ts`) for any consumer that wants to poll synchronously.

The interval is cleared on `SIGINT` so the timer doesn't keep the process alive during shutdown.

## Browser display

`apps/web/src/components/AssessmentPanel.tsx` consumes `threatcon` and `pirs` from the Zustand store. Two cards:

- **THREATCON card** — large numeric score colored by `level` (`text-threat-critical / -high / -elevated / -guarded / -nominal`), a 0–100% gauge bar, and the `reasons[]` list rendered below as bullet points.
- **PIR card** — one row per PIR. The `answer` is rendered as a small pill (`yes` → `text-threat-high` / `no` → `text-threat-nominal` / `unknown` → neutral) followed by the question text and (if present) the `detail` line.

Both cards are tagged for the Overseer agent: `data-agent="threatcon-card"` and `data-agent="pir-card"`. Each individual PIR row is `data-agent="pir-${p.id}"`.

## End-to-end timing

1. A `seismic` event with `payload.mag = 5.2, geo = {lat: 38.1, lon: -122.3}` arrives via `usgs-quakes.ts`.
2. It is persisted via `persistEvent()` and broadcast as `{type:"event"}`.
3. The next 15 s tick fires. `recentEvents(1000)` returns the M5.2 event among the last 1000 rows. `computeThreatcon` adds `severity=high → +0.3` from the global term. If a saved Location like `{id: "loc_sf", radiusKm: 250}` exists at SF, the proximity term adds `3 * 0.7 = 2.1` and pushes a reason like `"M5.2 quake near Vallejo (53 km from SF HQ)"`.
4. `computePIR` returns `quake-200km → "yes"` because the magnitude is ≥ 4 and the haversine distance is ≤ 200 km.
5. Both envelopes ship over the WebSocket. The browser updates `s.threatcon` and `s.pirs`. The TopBar pill flips to amber/orange. The PIR row pill flips to red.

## Why these specific PIRs

The set is hard-coded — there is no database table or admin UI. The six were chosen to sample every category that has a connector with a meaningful severity mapping:

| Category | Sampled by PIR | Connector(s) |
|---|---|---|
| `weather` | `weather-25km` | `nws-alerts`, `open-meteo` |
| `seismic` | `quake-200km` | `usgs-quakes`, `emsc` |
| `fire` | `fire-nearby` | `nasa-firms` |
| `air` | `aqi-poor` | `openaq` |
| `iot` | `iot-breach` | `mqtt-generic`, `webhook` |
| `cv` | `cv-alert` | The browser's `cvWorker` (see [features/computer-vision](./computer-vision.md)) |

Adding a new PIR is a code change in `apps/fabric/src/threatcon.ts` plus a deploy. The schema accepts arbitrary IDs, so a maintainer who needs e.g. a `space-storm` PIR can append a new `mk(...)` call and ship it.

## Limits worth knowing

- **No hysteresis.** A single late-arriving event can flip the level back and forth at the 8.0 / 6.0 / 4.0 / 2.0 boundaries on consecutive ticks.
- **No score history.** The 15 s tick replaces the last value; there is no time series stored anywhere.
- **No per-Location THREATCON.** With multiple Locations configured, scores accumulate into one global number. A user with both home and work would see "5.7 elevated" without knowing which Location is driving it (the `reasons` list does name the Location, though).
- **Severity mapping is the connectors' responsibility.** A buggy connector that emits `severity: "extreme"` for routine events will inflate THREATCON. The engine doesn't sanity-check.

## Related pages

- [features/alert-rules](./alert-rules.md) — per-event matching that runs on the same broadcast pipeline.
- [features/briefing-generator](./briefing-generator.md) — the briefing prompt embeds the current THREATCON + PIR snapshot.
- [apps/fabric](../apps/fabric.md) — `startThreatLoop`, `broadcast`, and the fabric event flow.
- [overview/glossary](../overview/glossary.md) — "THREATCON", "PIR".
