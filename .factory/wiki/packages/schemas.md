# packages/schemas

The contract layer. 179 lines, one file: `packages/schemas/src/index.ts`. Every wire object is a Zod schema, and every TypeScript type is a `z.infer<typeof X>`. The fabric and the web app import from here via the workspace alias `@overwatch/schemas`.

This is by design: there is *no* second schema, no DTO duplication, no OpenAPI generator. If a piece of data crosses a process boundary, it lives here.

## What's exported

```ts
GeoPoint                                 // { lat, lon, alt? }
Severity                                 // "info" | "low" | "moderate" | "high" | "extreme"
EventCategory                            // 16 categories — see below
IngestEvent                              // the canonical event shape
ConnectorAuthKind                        // "none" | "api-key" | "oauth" | "mqtt" | "webhook" | "rtsp"
ConnectorStatus                          // runtime status as seen by the dashboard
ConnectorDefinition                      // static catalog row (no live state)
Location                                 // user-saved place with radius
ThreatCon                                // score + level + reasons + computedAt
PIR                                      // priority-intelligence requirement (Q + answer)
CameraFeed                               // camera config: rtsp/hls/mjpeg/webcam/youtube + detectors
AlertRuleCondition                       // categories, minSev, keywords, bbox, near-loc, rate-limit
AlertRule                                // condition + notification spec
AlertFiring                              // a rule match
ServerToClient                           // discriminatedUnion("type", …) — WebSocket envelope
ClientToServer                           // discriminatedUnion("type", …) — currently subscribe + ping
```

## EventCategory

```ts
"weather" | "seismic" | "air" | "transport" | "power" | "water" |
"news" | "iot" | "cv" | "space" | "finance" | "social" |
"fire" | "lightning" | "health" | "other"
```

Adding a new category requires touching:
1. `packages/schemas/src/index.ts → EventCategory`.
2. `apps/web/src/components/IntelFeed.tsx → CATS` array (left-rail filter pills).
3. Any connector that should emit it.

## IngestEvent

The shape every connector emits and every consumer reads:

```ts
{
  id: string;                  // unique per connector; the orchestrator dedupes by this
  source: string;              // human-readable, set by the orchestrator
  connectorId: string;         // the originating connector's id, set by the orchestrator
  category: EventCategory;
  severity: Severity;          // default "info"
  title: string;
  summary?: string;
  occurredAt: string;          // ISO 8601, when the event happened in the world
  receivedAt: string;          // ISO 8601, set by the orchestrator on ingest
  geo?: { lat, lon, alt? };
  geoMentioned?: string;       // for events without a precise centroid
  payload?: Record<string, any>;  // free-form connector-specific data
  icon?: string;               // optional Lucide-icon hint, see IntelFeed → EventIcon
  url?: string;                // canonical link to the source article/incident
}
```

Connector authors set everything *except* `source`, `connectorId`, and `receivedAt` — the orchestrator stamps those (see `apps/fabric/src/orchestrator.ts → runOne → emit`). Severity defaults to `"info"` if omitted.

`payload` is intentionally untyped. The browser may safely read named keys when it knows the shape (e.g., `payload.icao24` for OpenSky → drives [aircraft trails](../features/aircraft-trails.md)) but should never assume a global structure.

## AlertRule and AlertFiring

```ts
AlertRule = {
  id, label, enabled,
  notify: { desktop, sound, soundKind: chime|siren|tone|none, severityFloor },
  condition: AlertRuleCondition,
};

AlertRuleCondition = {
  categories?: EventCategory[],
  minSeverity?: Severity,
  keywords: string[],            // case-insensitive substring match on title+summary
  bbox?: [minLon, minLat, maxLon, maxLat],
  nearLocationId?, nearKm?,      // require both; haversine to a saved Location
  rateLimitMs: number,           // default 60_000
};

AlertFiring = {
  id, ruleId, ruleLabel,
  event: IngestEvent,
  firedAt: ISO,
  reason: string,                // human-readable concatenation of matched conditions
};
```

Evaluated in `apps/fabric/src/alerts.ts → RuleEngine.evaluate()`. See [features/alert-rules](../features/alert-rules.md) for the engine semantics.

## ServerToClient — the WebSocket envelope

```ts
ServerToClient = z.discriminatedUnion("type", [
  { type: "event",     data: IngestEvent },
  { type: "status",    data: ConnectorStatus[] },
  { type: "threatcon", data: ThreatCon },
  { type: "pir",       data: PIR[] },
  { type: "hello",     data: { sessionId, ts } },
  { type: "snapshot",  data: { events: IngestEvent[] } },
  { type: "alert",     data: AlertFiring },
  { type: "rules",     data: AlertRule[] },
]);
```

To add a new envelope type, append a new `z.object({...})` to the union. **Both ends** must compile against the new schema before either side can produce or consume it. In practice that means:

1. Edit `packages/schemas/src/index.ts`.
2. Add a sender in `apps/fabric/src/index.ts` (an `app.something()` route or an event listener that calls `broadcast({type:"newType", data:…})`).
3. Add a handler in `apps/web/src/lib/ws.ts → ws.onmessage`.

## ClientToServer

```ts
ClientToServer = z.discriminatedUnion("type", [
  { type: "subscribe", data: { categories?: EventCategory[], bbox?: [n,n,n,n] } },
  { type: "ping",      data: {} },
]);
```

Currently the fabric ignores both — it accepts every connection and pushes everything. The schema is here for forward compatibility.

## Adding a schema field

The Zod-first approach means there is exactly one place to edit. Example: adding `payload.duress?: boolean` is a *no-op* — `payload` is `z.record(z.any())` and accepts anything. Adding a top-level `IngestEvent.tags?: string[]` is two lines:

```ts
export const IngestEvent = z.object({
  // …
  tags: z.array(z.string()).optional(),
});
```

`@overwatch/web` and `@overwatch/fabric` both pick up the new optional field on next typecheck. The DB schema in `apps/fabric/src/db.ts` would need a column if you want it persisted, but the field will travel through the WebSocket regardless.

## Validation discipline

The schemas exist but are *under-used as runtime validators*. The orchestrator hand-stamps fields rather than `IngestEvent.parse(...)`-ing the connector output. The web app consumes WebSocket envelopes with a plain `JSON.parse` and a `switch (msg.type)` — no `ServerToClient.parse(msg)`.

This is a deliberate tradeoff: trust the in-process producers, save the per-event Zod overhead. The schemas are:
1. The shared TypeScript type source.
2. The basis of the connector catalog (`apps/fabric/src/index.ts → extractFields()` walks `c.configSchema._def.shape()` to render the dynamic Add-Connector form).
3. A hand-readable contract document.

If you need stricter validation at a boundary (say, before `POST /api/cv-event` accepts arbitrary browser input), you can add `IngestEvent.parse(...)` ad-hoc — the schema is already imported in `apps/fabric/src/index.ts`.

## Files

- `packages/schemas/src/index.ts` — every schema and type, all 179 lines.
- `packages/schemas/package.json` — `"main": "./src/index.ts"`, no build step. The TypeScript path mapping in `tsconfig.base.json` (`"@overwatch/schemas": ["packages/schemas/src/index.ts"]`) means consumers compile the source directly.
