# Alert rules

The alert rules feature is a thin **rule engine + persisted rules table + sound/desktop notification** stack that converts arbitrary `IngestEvent`s into user-attention. It is the one feature that is almost entirely orthogonal to the rest of the app: a rule could be added or deleted with the dashboard untouched and everything else still works.

## Surface area

| Concern | File |
|---|---|
| Wire schema (Zod) | `packages/schemas/src/index.ts` (`AlertRule`, `AlertRuleCondition`, `AlertFiring`) |
| Persistence | `apps/fabric/src/db.ts` (`alert_rules`, `alert_firings` tables) |
| Evaluator | `apps/fabric/src/alerts.ts` (`RuleEngine`) |
| HTTP CRUD + WS broadcast | `apps/fabric/src/index.ts` |
| Browser delivery | `apps/web/src/lib/ws.ts` (alert handler), `apps/web/src/lib/notify.ts` |
| CRUD UI | `apps/web/src/app/rules/page.tsx` |
| Firing badge | `apps/web/src/components/TopBar.tsx` |

## Schema

`packages/schemas/src/index.ts`:

```ts
export const AlertRuleCondition = z.object({
  categories: z.array(EventCategory).optional(),
  minSeverity: Severity.optional(),
  keywords: z.array(z.string()).default([]),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  nearLocationId: z.string().optional(),
  nearKm: z.number().optional(),
  rateLimitMs: z.number().default(60_000),
});

export const AlertRule = z.object({
  id: z.string(),
  label: z.string(),
  enabled: z.boolean().default(true),
  notify: z.object({
    desktop: z.boolean().default(true),
    sound: z.boolean().default(true),
    soundKind: z.enum(["chime", "siren", "tone", "none"]).default("chime"),
    severityFloor: Severity.default("moderate"),
  }),
  condition: AlertRuleCondition,
});

export const AlertFiring = z.object({
  id: z.string(),
  ruleId: z.string(),
  ruleLabel: z.string(),
  event: IngestEvent,
  firedAt: z.string().datetime(),
  reason: z.string(),
});
```

The condition object is intentionally **all-optional**. An empty `{}` matches every event (still subject to the default 60 s rate limit). The `notify.severityFloor` field is declared but is *not* read by the current evaluator — the only severity gate is `condition.minSeverity`. See [fun-facts](../overview/fun-facts.md).

## Persistence

`apps/fabric/src/db.ts` declares two tables:

```sql
CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  label TEXT,
  enabled INTEGER DEFAULT 1,
  notify TEXT,        -- JSON
  condition TEXT      -- JSON
);

CREATE TABLE IF NOT EXISTS alert_firings (
  id TEXT PRIMARY KEY,
  rule_id TEXT,
  rule_label TEXT,
  event_id TEXT,
  fired_at TEXT,
  reason TEXT,
  payload TEXT        -- JSON-encoded IngestEvent
);
CREATE INDEX IF NOT EXISTS idx_firings_at ON alert_firings(fired_at DESC);
```

`listRules()` decodes both JSON columns; `upsertRule()` re-encodes them. `recordFiring()` inserts into `alert_firings` and stringifies the full `event` into `payload` so the firings page can render the original card later.

## RuleEngine.evaluate

`apps/fabric/src/alerts.ts` — the entire matcher fits in roughly 60 lines. For each rule it ANDs the optional clauses:

```ts
evaluate(event: IngestEvent): AlertFiring[] {
  const out: AlertFiring[] = [];
  const now = Date.now();
  for (const rule of this.rules) {
    if (!rule.enabled) continue;
    const reasons: string[] = [];
    const c = rule.condition;
    if (c.categories?.length && !c.categories.includes(event.category)) continue;
    if (c.minSeverity) {
      const e = SEVERITY_RANK[event.severity] ?? 0;
      const m = SEVERITY_RANK[c.minSeverity] ?? 0;
      if (e < m) continue;
      reasons.push(`severity ${event.severity} >= ${c.minSeverity}`);
    } else {
      reasons.push(`severity ${event.severity}`);
    }
    if (c.keywords?.length) {
      const haystack = `${event.title} ${event.summary ?? ""}`.toLowerCase();
      const hit = c.keywords.find((k) => haystack.includes(k.toLowerCase()));
      if (!hit) continue;
      reasons.push(`keyword "${hit}"`);
    }
    if (c.bbox) {
      if (!event.geo) continue;
      const [minLon, minLat, maxLon, maxLat] = c.bbox;
      if (event.geo.lat < minLat || event.geo.lat > maxLat ||
          event.geo.lon < minLon || event.geo.lon > maxLon) continue;
      reasons.push(`inside bbox`);
    }
    if (c.nearLocationId && c.nearKm) {
      if (!event.geo) continue;
      const loc = listLocations().find((l: any) => l.id === c.nearLocationId);
      if (!loc) continue;
      const d = distanceKm(event.geo, { lat: loc.lat, lon: loc.lon });
      if (d > c.nearKm) continue;
      reasons.push(`${d.toFixed(1)}km from ${loc.label}`);
    }
    const lim = c.rateLimitMs ?? 60_000;
    const last = this.lastFire.get(rule.id) ?? 0;
    if (now - last < lim) continue;
    this.lastFire.set(rule.id, now);
    // build firing, persist, emit
  }
  return out;
}
```

Properties:

- **Severity rank lookup** is fixed at `info=0, low=1, moderate=2, high=3, extreme=4`.
- **Keywords** match case-insensitively as substrings against `title + " " + summary`. There is no regex support and no boolean composition (everything is OR within the array).
- **bbox** is `[minLon, minLat, maxLon, maxLat]` and rejects events without `geo`.
- **`nearLocationId + nearKm`** runs an inline Haversine (Earth radius 6371 km) against the row in the `locations` table. Events without `geo` are dropped silently.
- **`rateLimitMs`** is per-rule (keyed by `rule.id`) and tracked in an in-memory `Map<string, number>`. It defaults to 60 000 ms when the rule omits it. It is NOT persisted across restarts — every rule effectively gets a free fire on the first event after `pnpm --filter @overwatch/fabric dev` boots.
- **Reasons** are accumulated in a `string[]` and joined with `" + "` into the final `AlertFiring.reason`. The browser shows them verbatim under each firing card.
- **`recordFiring()` is wrapped in try/catch.** A persistence failure does not block the broadcast.

## Wiring on the fabric side

`apps/fabric/src/index.ts` constructs a single `RuleEngine` at module init and threads it into the orchestrator:

```ts
const ruleEngine = new RuleEngine();
orchestrator.on("event", (ev) => {
  broadcast({ type: "event", data: ev });
  for (const firing of ruleEngine.evaluate(ev)) {
    broadcast({ type: "alert", data: firing });
  }
});
ruleEngine.on("rules", (rules) => broadcast({ type: "rules", data: rules }));
```

So every event is broadcast first, then rule evaluation runs, then any matching firings are broadcast. The order matters because `ws.ts` updates the events array before showing the toast.

REST routes:

- `GET /api/rules` → `ruleEngine.list()`.
- `POST /api/rules` — accepts a partial body, fills defaults (`notify.desktop=true, sound=true, soundKind="chime", severityFloor="moderate"`, `condition.rateLimitMs=60_000`, `condition.keywords=[]`), persists, and `ruleEngine.reload()`s.
- `DELETE /api/rules/:id` — same reload pattern.
- `GET /api/firings?limit=100` — last N rows from `alert_firings` ordered by `fired_at DESC`.

## Browser delivery

`apps/web/src/lib/ws.ts` handles `{type:"alert"}` envelopes:

```ts
else if (msg.type === "alert") {
  const f = msg.data;
  pushFiring(f);
  const rule = useStore.getState().rules.find((r) => r.id === f.ruleId);
  if (rule?.notify?.sound) playSound(rule.notify.soundKind ?? "chime");
  if (rule?.notify?.desktop) {
    const ev = f.event ?? {};
    const where = ev.geo
      ? ` @ ${ev.geo.lat.toFixed(2)},${ev.geo.lon.toFixed(2)}`
      : "";
    showDesktopNotification(
      `${f.ruleLabel}`,
      `${ev.severity?.toUpperCase?.() ?? ""} ${ev.title ?? "alert"}${where}`,
      { tag: f.ruleId },
    );
  }
}
```

The `tag: f.ruleId` collapses repeat firings of the same rule into a single notification slot in the OS tray. `pushFiring` caps the in-store list at 200 (`apps/web/src/lib/store.ts`).

`apps/web/src/lib/notify.ts` defines three sound profiles built from a single shared `AudioContext`:

- **chime** — three sine notes at 880 / 1320 / 1760 Hz, staggered 120 ms apart. Each note ramps from 0 to 0.6 in 20 ms then exponential-decays to silence over 450 ms.
- **siren** — sawtooth oscillator that ramps between 420 Hz and 880 Hz every 200 ms for 1.6 s.
- **tone** — single 660 Hz triangle wave with a 600 ms exponential decay.
- **none** — early return, no audio.

`ensureNotifyPermission()` is idempotent: it returns the current permission immediately if it is not `"default"`, otherwise it calls `Notification.requestPermission()`. The Rules page exposes a "Request permission" button that wraps it.

## CRUD UI

`apps/web/src/app/rules/page.tsx` is a single-route CRUD screen with a left sidebar (notification permission status, sound preview buttons, recent firings) and a right panel listing rules. The `RuleEditor` modal is a controlled form with:

- **Label** text input.
- **Categories** — pill toggle row over `weather, seismic, fire, air, transport, power, news, iot, cv, space, finance, social, other`.
- **Min severity** — `<select>` over the five severity levels.
- **Rate limit (sec)** — number input that gets multiplied by 1000 on save.
- **Keywords** — comma-separated; the form splits, trims, and filters empties on save.
- **Bounding box** — a single `minLon,minLat,maxLon,maxLat` text input. Parsed with `.map(Number)` and only kept if all four parts are finite.
- **Near location id** + **Within km** — both free-form; not reconciled against the locations list, so a typo silently disables the geofence.
- **Notification** — desktop checkbox, sound checkbox, `soundKind` select (chime/siren/tone/silent), `enabled` checkbox.

Save is `POST /api/rules` with the full draft. Delete is `DELETE /api/rules/:id`. Both refresh the local list.

## Firing badge

`apps/web/src/components/TopBar.tsx` reads `firings` from the store, slices the most recent three, and changes the Rules link to amber when `recentFirings.length > 0`:

```tsx
<a
  href="/rules"
  className={cn("badge gap-1 hover:bg-white/10", recentFirings.length > 0 && "text-amber-300")}
  title={recentFirings.map((f) => f.ruleLabel).join(" · ") || "alert rules"}
>
  Rules{rules.length ? ` (${rules.length})` : ""}
  {recentFirings.length > 0 && (
    <span className="ml-1 rounded bg-amber-300/20 px-1 text-[10px]">{recentFirings.length}</span>
  )}
</a>
```

There is no "mark seen" affordance — the count is always the last three firings ever, period. Reload the page to clear it (the store is in-memory).

## End-to-end example

A rule like *"M5+ earthquake within 500 km of San Francisco HQ"* travels through the system as follows:

1. The user opens `/rules`, clicks **New rule**, sets:
   - label: `"M5+ near SF HQ"`
   - categories: `["seismic"]`
   - minSeverity: `high` (USGS maps M≥5 → `high` in `usgs-quakes.ts`)
   - nearLocationId: `loc_sf_hq`, nearKm: `500`
   - rate limit: 300 s
   - notify.desktop: true, sound: true, soundKind: `siren`.
2. Clicks Save → `POST /api/rules` → `upsertRule(rule)` → `ruleEngine.reload()` → `{type:"rules"}` envelope to all clients.
3. `usgs-quakes.ts` emits an M5.4 event near Vallejo. The orchestrator persists, broadcasts `{type:"event"}`, and calls `ruleEngine.evaluate(event)`.
4. The rule matches: category ✓, severity ≥ high ✓, distance 53 km ≤ 500 ✓, last fire 0 ms ≥ 300 000 ✗ but `lastFire` map is empty so `now - 0 < 300000` is false → fires.
5. `reason = "severity high >= high + 53.2km from SF HQ"`. `recordFiring()` writes to `alert_firings`. `RuleEngine` emits `alert`. Fastify's `broadcast()` pushes `{type:"alert"}`.
6. The browser's `ws.ts` calls `pushFiring(f)` (badge updates from green → amber), `playSound("siren")` (the 1.6 s sawtooth sweep), and `showDesktopNotification("M5+ near SF HQ", "HIGH M5.4 - 14km W of Vallejo @ 38.12,-122.32", { tag: ruleId })`.
7. If a second M5+ event lands 100 s later, the rule matches but `now - last = 100_000 < 300_000`, so it is dropped silently. The user sees the underlying event in the feed but no toast.

## Failure modes worth knowing

- **Rate limit only persists in-memory.** Restart fabric and the next matching event will fire immediately, regardless of how recent the last firing was.
- **`nearLocationId` is not validated.** A non-existent ID is treated as "no match", so the rule simply never fires.
- **`recordFiring()` errors are swallowed.** The browser still receives the toast and updates the badge, so it can be confusing if the firings list is empty later.
- **No retry, no Slack/PagerDuty webhooks.** A user who closes the browser tab when fabric fires misses the alert entirely. There is no email digest, no SMS, no outbound notification of any kind.
- **`notify.severityFloor`** is in the schema but unused; rule severity is gated only by `condition.minSeverity`.

## Related pages

- [features/threatcon-pir](./threatcon-pir.md) — the *aggregate* signal that runs alongside per-event rules.
- [apps/fabric](../apps/fabric.md) — REST + WebSocket entry points and broadcast plumbing.
- [packages/schemas](../packages/schemas.md) — full Zod definitions.
- [overview/glossary](../overview/glossary.md) — "Alert rule", "Alert firing".
