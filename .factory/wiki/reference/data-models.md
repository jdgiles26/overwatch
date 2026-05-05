# Data models

Every wire object in Overwatch is a Zod schema in `packages/schemas/src/index.ts` (179 lines, single file). Every TypeScript type is `z.infer<typeof Schema>`. The fabric and the web app share one source of truth via the workspace alias `@overwatch/schemas`. See [packages/schemas](../packages/schemas.md) for the narrative.

This page is the field-by-field reference. Defaults, constraints, and the SQLite columns each schema persists to are spelled out below.

## Zod schemas

### `GeoPoint`

```ts
GeoPoint = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  alt: z.number().optional(),
});
```

| Field | Type | Constraints | Persists to |
|---|---|---|---|
| `lat` | number | -90..90 | `events.lat`, `cameras.lat`, `locations.lat` |
| `lon` | number | -180..180 | `events.lon`, `cameras.lon`, `locations.lon` |
| `alt` | number? | unconstrained | `events.alt` |

### `Severity`

```ts
Severity = z.enum(["info", "low", "moderate", "high", "extreme"]);
```

Numeric ranks used internally (`apps/fabric/src/alerts.ts:SEVERITY_RANK`, `apps/fabric/src/threatcon.ts:sev()`):

| Severity | Rank |
|---|---|
| `info` | 0 |
| `low` | 1 |
| `moderate` | 2 |
| `high` | 3 |
| `extreme` | 4 |

### `EventCategory`

Sixteen values:

```ts
EventCategory = z.enum([
  "weather", "seismic", "air", "transport", "power", "water",
  "news", "iot", "cv", "space", "finance", "social",
  "fire", "lightning", "health", "other",
]);
```

Adding a new category requires editing this enum, the `CATS` array in `apps/web/src/components/IntelFeed.tsx`, and any connector that should emit it.

### `IngestEvent`

The canonical event shape every connector emits.

```ts
IngestEvent = z.object({
  id: z.string(),
  source: z.string(),
  connectorId: z.string(),
  category: EventCategory,
  severity: Severity.default("info"),
  title: z.string(),
  summary: z.string().optional(),
  occurredAt: z.string().datetime(),
  receivedAt: z.string().datetime(),
  geo: GeoPoint.optional(),
  geoMentioned: z.string().optional(),
  payload: z.record(z.any()).optional(),
  icon: z.string().optional(),
  url: z.string().url().optional(),
});
```

| Field | Default | Meaning | DB column (`events`) |
|---|---|---|---|
| `id` | — | Unique per connector. Orchestrator dedupes via `INSERT OR REPLACE`. | `id` (PK) |
| `source` | — | Human-readable, set by the orchestrator. | `source` |
| `connectorId` | — | Originating connector id. Set by the orchestrator. | `connector_id` |
| `category` | — | One of 16 categories. | `category` (indexed) |
| `severity` | `"info"` | Rank used for THREATCON, alert min-severity, color. | `severity` (indexed) |
| `title` | — | Card headline. | `title` |
| `summary` | undefined | Card body text. Persists as `""` if omitted. | `summary` |
| `occurredAt` | — | When the event happened (ISO 8601). | `occurred_at` |
| `receivedAt` | — | When the orchestrator stamped it (ISO 8601). | `received_at` (indexed DESC) |
| `geo` | undefined | `{ lat, lon, alt? }`. | `lat`, `lon`, `alt` |
| `geoMentioned` | undefined | Place name when no precise centroid. | `geo_mentioned` |
| `payload` | undefined | Free-form `Record<string, any>`. JSON-encoded on write. | `payload` |
| `icon` | undefined | Lucide icon hint, mapped by `IntelFeed → EventIcon`. | `icon` |
| `url` | undefined | Source link. Validated as URL. | `url` |

`payload` is intentionally untyped. The browser may safely read named keys when it knows the shape (e.g., `payload.icao24` for OpenSky → drives [aircraft trails](../features/aircraft-trails.md)).

Connector authors set everything except `source`, `connectorId`, and `receivedAt`.

### `ConnectorAuthKind`

```ts
ConnectorAuthKind = z.enum(["none", "api-key", "oauth", "mqtt", "webhook", "rtsp"]);
```

### `ConnectorStatus`

Runtime status as seen by the dashboard. Produced by `orchestrator.allStatus()` in `apps/fabric/src/orchestrator.ts`.

```ts
ConnectorStatus = z.object({
  id: z.string(),
  label: z.string(),
  category: EventCategory,
  authKind: ConnectorAuthKind,
  enabled: z.boolean(),
  connected: z.boolean(),
  lastEventAt: z.string().datetime().optional(),
  eventsLastMinute: z.number().default(0),
  eventsLastHour: z.number().default(0),
  errors: z.array(z.string()).default([]),
  configured: z.boolean().default(false),
});
```

Not persisted directly; computed from a per-instance ring buffer of timestamps.

### `ConnectorDefinition`

The static catalog row (no live state). Returned by `GET /api/connectors/catalog`.

```ts
ConnectorDefinition = z.object({
  id, label, description, category, authKind,
  configSchema: z.any(),
  homepageUrl: z.string().optional(),
  docsUrl: z.string().optional(),
  freeTier: z.boolean().default(true),
});
```

The `/api/connectors/catalog` route augments each definition with `defaults` and `configFields[]` derived from the Zod `configSchema` (see `extractFields()` in `apps/fabric/src/index.ts`).

### `Location`

User-saved place with a radius.

```ts
Location = z.object({
  id: z.string(),
  label: z.string(),
  geo: GeoPoint,
  radiusKm: z.number().default(25),
  kind: z.enum(["home", "work", "school", "family", "other"]).default("home"),
});
```

| Field | Default | DB column (`locations`) |
|---|---|---|
| `id` | — | `id` (PK) |
| `label` | — | `label` |
| `geo.lat` / `geo.lon` | — | `lat` / `lon` |
| `radiusKm` | `25` (also defaulted at SQL layer to 25 in `upsertLocation`) | `radius_km` |
| `kind` | `"home"` (also defaulted at SQL layer) | `kind` |

Used by THREATCON proximity scoring and alert rules (`condition.nearLocationId + nearKm`).

### `ThreatCon`

```ts
ThreatCon = z.object({
  score: z.number().min(0).max(10),
  level: z.enum(["nominal", "guarded", "elevated", "high", "critical"]),
  reasons: z.array(z.string()),
  computedAt: z.string().datetime(),
});
```

Computed by `apps/fabric/src/threatcon.ts:computeThreatcon()` over the last 1,000 events. Bands from `apps/fabric/src/threatcon.ts`:

```ts
score >= 8 -> "critical"
score >= 6 -> "high"
score >= 4 -> "elevated"
score >= 2 -> "guarded"
else        -> "nominal"
```

Not persisted; broadcast every 15 s.

### `PIR`

```ts
PIR = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.enum(["yes", "no", "unknown"]),
  detail: z.string().optional(),
  evidenceIds: z.array(z.string()).default([]),
});
```

Six PIRs are produced by `apps/fabric/src/threatcon.ts:computePIR()`. Not persisted.

### `CameraFeed`

```ts
CameraFeed = z.object({
  id: z.string(),
  label: z.string(),
  source: z.string(),
  kind: z.enum(["rtsp", "hls", "mjpeg", "webcam", "youtube"]),
  geo: GeoPoint.optional(),
  whepUrl: z.string().optional(),
  hlsUrl: z.string().optional(),
  detectors: z.array(z.enum(["motion", "person", "vehicle", "fire", "plate"])).default([]),
});
```

| Field | DB column (`cameras`) |
|---|---|
| `id` | `id` (PK) |
| `label` | `label` |
| `source` | `source` |
| `kind` | `kind` |
| `geo.lat` / `geo.lon` | `lat` / `lon` |
| `whepUrl` | `whep_url` |
| `hlsUrl` | `hls_url` |
| `detectors` | `detectors` (JSON-encoded array) |

`upsertCamera()` `JSON.stringify`s `detectors`; `GET /api/cameras` JSON-decodes it on read.

### `AlertRuleCondition`

```ts
AlertRuleCondition = z.object({
  categories: z.array(EventCategory).optional(),
  minSeverity: Severity.optional(),
  keywords: z.array(z.string()).default([]),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  nearLocationId: z.string().optional(),
  nearKm: z.number().optional(),
  rateLimitMs: z.number().default(60_000),
});
```

All fields are ANDed in `apps/fabric/src/alerts.ts:evaluate()`. `nearLocationId` requires `nearKm` to also be set.

### `AlertRule`

```ts
AlertRule = z.object({
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
```

| Field | DB column (`alert_rules`) |
|---|---|
| `id` | `id` (PK) |
| `label` | `label` |
| `enabled` | `enabled` (0/1 int) |
| `notify` | `notify` (JSON blob) |
| `condition` | `condition` (JSON blob) |

`apps/fabric/src/db.ts:listRules()` JSON-decodes `notify` and `condition` on read; `upsertRule()` JSON-encodes them on write.

### `AlertFiring`

```ts
AlertFiring = z.object({
  id: z.string(),
  ruleId: z.string(),
  ruleLabel: z.string(),
  event: IngestEvent,
  firedAt: z.string().datetime(),
  reason: z.string(),
});
```

| Field | DB column (`alert_firings`) |
|---|---|
| `id` | `id` (PK) |
| `ruleId` | `rule_id` |
| `ruleLabel` | `rule_label` |
| `event.id` | `event_id` |
| `firedAt` | `fired_at` (indexed DESC) |
| `reason` | `reason` |
| `event` | `payload` (JSON blob) |

### `ServerToClient`

8-arm discriminated union; see [reference/configuration § websocket-envelope-types](./configuration.md#websocket-envelope-types).

### `ClientToServer`

2-arm discriminated union (`subscribe` and `ping`). The fabric currently ignores both; the schema is reserved for forward compatibility.

## SQLite tables

Created with `IF NOT EXISTS` in `apps/fabric/src/db.ts`. Seven tables, three indexes.

### `events`

```sql
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  source TEXT,
  connector_id TEXT,
  category TEXT,
  severity TEXT,
  title TEXT,
  summary TEXT,
  occurred_at TEXT,
  received_at TEXT,
  lat REAL, lon REAL, alt REAL,
  geo_mentioned TEXT,
  url TEXT,
  icon TEXT,
  payload TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_received ON events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_category ON events(category);
CREATE INDEX IF NOT EXISTS idx_events_severity ON events(severity);
```

Every `IngestEvent` lands here. `payload` is JSON-encoded; `received_at` carries the ISO timestamp the orchestrator stamped. Reads are `ORDER BY received_at DESC LIMIT ?` (`recentEvents`) or by bbox (`eventsByBbox`). The table grows forever — see [reference/deployment § production hardening](./deployment.md#production-hardening).

### `connector_instances`

```sql
CREATE TABLE IF NOT EXISTS connector_instances (
  id TEXT PRIMARY KEY,
  connector_id TEXT,
  label TEXT,
  enabled INTEGER DEFAULT 1,
  config TEXT
);
```

One row per running connector. `config` is the AES-256-GCM-encrypted JSON blob (base64 of `iv12 || tag16 || ciphertext`). Decrypted by the orchestrator on `start()`. See [reference/security](./security.md#aes-256-gcm-keystore).

### `cameras`

```sql
CREATE TABLE IF NOT EXISTS cameras (
  id TEXT PRIMARY KEY,
  label TEXT,
  source TEXT,
  kind TEXT,
  lat REAL, lon REAL,
  whep_url TEXT,
  hls_url TEXT,
  detectors TEXT
);
```

`detectors` is the JSON-encoded array from the Zod schema.

### `locations`

```sql
CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  label TEXT,
  lat REAL, lon REAL,
  radius_km REAL,
  kind TEXT
);
```

User-saved Locations. `radius_km` defaults to 25 in `upsertLocation()` if omitted; `kind` defaults to `"home"`.

### `alert_rules`

```sql
CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  label TEXT,
  enabled INTEGER DEFAULT 1,
  notify TEXT,
  condition TEXT
);
```

`notify` and `condition` are JSON blobs. The engine in `apps/fabric/src/alerts.ts` reads and decodes them on `reload()`.

### `alert_firings`

```sql
CREATE TABLE IF NOT EXISTS alert_firings (
  id TEXT PRIMARY KEY,
  rule_id TEXT,
  rule_label TEXT,
  event_id TEXT,
  fired_at TEXT,
  reason TEXT,
  payload TEXT
);
CREATE INDEX IF NOT EXISTS idx_firings_at ON alert_firings(fired_at DESC);
```

Persisted rule firings. `payload` is the JSON-encoded `IngestEvent` so the firing card on `/rules` can reconstruct the event without re-querying `events`.

### `aois`

```sql
CREATE TABLE IF NOT EXISTS aois (
  id TEXT PRIMARY KEY,
  label TEXT,
  polygon TEXT
);
```

Polygons stored as a JSON `[[lon,lat], ...]` array. Consumed by `apps/web/src/components/Map2D.tsx` for click-to-select. No other downstream uses yet.

## See also

- [packages/schemas](../packages/schemas.md) — Zod-first design rationale and adding-a-field walkthrough.
- [reference/configuration § REST endpoints](./configuration.md#rest-endpoints) — which routes consume which schemas.
- [apps/fabric § db.ts](../apps/fabric.md#dbts-sqlite-crypto) — narrative description of the persistence layer.
