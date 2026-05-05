# packages/connectors

Twenty-two self-contained modules under `packages/connectors/src/sources/*.ts`, each speaking exactly one external feed. 1,527 lines total. No build step — `tsconfig.base.json` aliases `@overwatch/connectors` directly to `packages/connectors/src/index.ts` and consumers compile from source.

The orchestrator (`apps/fabric/src/orchestrator.ts`) instantiates each connector inside its own infinite `run()` loop, scoped to an `AbortController`.

## The catalog

| ID | Label | Category | Auth | File | Polls | Notes |
|---|---|---|---|---|---|---|
| `nws-alerts` | NWS Weather Alerts | weather | none | `nws-alerts.ts` | 60s | NWS CAP/GeoJSON. Severity mapped Minor/Moderate/Severe/Extreme → low/moderate/high/extreme. Centroid extracted from polygon/multipolygon. |
| `usgs-quakes` | USGS Earthquakes | seismic | none | `usgs-quakes.ts` | 60s | GeoJSON summary feeds. Severity by magnitude (≥6 extreme, ≥5 high, ≥3.5 moderate). |
| `nasa-eonet` | NASA EONET Events | other | none | `nasa-eonet.ts` | 5min | Earth Observatory natural events: storms, wildfires, dust, icebergs. |
| `iss-location` | ISS Live Position | space | none | `iss-location.ts` | 12s | `wheretheiss.at` API. Emits a single event per poll with the current sub-satellite point. |
| `openaq` | OpenAQ Air Quality | air | api-key | `openaq.ts` | 10min | PM2.5 + O3. Optional `OPENAQ_API_KEY` raises the rate limit. |
| `opensky` | OpenSky Flights (ADS-B) | transport | api-key | `opensky.ts` | 20s | Live aircraft state vectors. Default bbox covers continental US. **Drives [aircraft trails](../features/aircraft-trails.md)** via `payload.icao24`. |
| `gdelt` | GDELT Global | news | none | `gdelt.ts` | 10min | GDELT 2.0 doc API; geocoded news articles. |
| `hackernews` | Hacker News | news | none | `hackernews.ts` | 60s | `new` / `top` items via Firebase API. |
| `wikipedia-rc` | Wikipedia Recent Changes | news | none | `wikipedia-rc.ts` | streaming | Server-Sent Events stream from `stream.wikimedia.org`. |
| `spacex` | SpaceX Launches | space | none | `spacex.ts` | 5min | r/spacex public API. Upcoming + recent launches with launchpad geo. |
| `open-meteo` | Open-Meteo Weather | weather | none | `openmeteo.ts` | 5min | Forecast + warnings around saved Locations. |
| `reddit` | Reddit | social | none | `reddit.ts` | 2min | `/.json` feed for one or more subreddits. |
| `github-events` | GitHub Public Events | social | api-key | `github-events.ts` | 60s | `/events` feed; optional `GITHUB_TOKEN` raises rate limit 60/hr → 5000/hr. |
| `coingecko` | Crypto Prices | finance | none | `coingecko.ts` | 60s | Top-N price snapshots; severity is `info` unless a configured threshold trips. |
| `mqtt-generic` | Generic MQTT | iot | mqtt | `mqtt-generic.ts` | n/a | Subscribes to topic patterns over WS/WSS. Defaults to HiveMQ public broker. |
| `webhook` | Generic Webhook | iot | webhook | `webhook.ts` | n/a | Registers a handler under `getWebhookRouter()` keyed by `config.key`. POST to `/ingest/:key` to fire. |
| `rss` | RSS / Atom | news | none | `rss.ts` | 5min | One or more feed URLs. Uses `xml2js`. |
| `noaa-swpc` | NOAA Space Weather | space | none | `noaa-swpc.ts` | 5min | Solar wind + Kp index; emits `extreme` on geomagnetic storm warnings. |
| `emsc` | EMSC Earthquakes | seismic | none | `emsc.ts` | 60s | European Mediterranean Seismological Centre, complements USGS for the EU/MENA region. |
| `nasa-firms` | NASA FIRMS | fire | api-key | `nasa-firms.ts` | 10min | Active fire pixels from VIIRS/MODIS. **Requires `NASA_FIRMS_MAP_KEY`.** |
| `rest-generic` | Generic REST poller | other | api-key | `rest-generic.ts` | configurable | Polls a JSON endpoint with optional headers / JSONPath. Bring-your-own-API. |
| `demo-simulator` | Demo Event Simulator | iot | none | `simulator.ts` | 8s | Generates plausible synthetic events at six world-city coords. Used by the seed script for instant zero-internet demos. |

All 22 are exported from `packages/connectors/src/index.ts` as both individual symbols and as the `ALL_CONNECTORS: Connector<any>[]` array. `getConnectorById(id)` returns the matching connector or `undefined`.

## The contract

`packages/connectors/src/types.ts`:

```ts
export interface Connector<TCfg = any> {
  id: string;
  label: string;
  description: string;
  category: EventCategory;
  authKind: ConnectorAuthKind;     // "none" | "api-key" | "oauth" | "mqtt" | "webhook" | "rtsp"
  homepageUrl?: string;
  docsUrl?: string;
  freeTier: boolean;
  configSchema: z.ZodTypeAny;       // a Zod schema for ctx.config
  defaultConfig: TCfg;
  pollIntervalMs?: number;
  run: (ctx: ConnectorCtx<TCfg>) => Promise<void>;
}

export interface ConnectorCtx<TCfg = unknown> {
  config: TCfg;
  signal: AbortSignal;
  log: (msg: string, extra?: unknown) => void;
  emit: (event: Omit<IngestEvent, "receivedAt"|"connectorId"|"source"> & {
    connectorId?: string;
    source?: string;
  }) => void;
  now: () => string;       // ISO 8601
  pollIntervalMs?: number;
}
```

Hard rules (also covered in [how-to-contribute § Conventions](../how-to-contribute/patterns-and-conventions.md#the-connector-contract)):

1. `run()` does not return until `ctx.signal` aborts. Use `await sleep(ms, signal)` from `packages/connectors/src/util.ts` between polls.
2. Pass `signal: ctx.signal` to every `fetch()` and use `ctx.signal.addEventListener("abort", …)` for non-fetch shutdowns (e.g., MQTT clients).
3. Don't set `connectorId`, `source`, `receivedAt` — the orchestrator stamps them.
4. Use `ctx.log(msg)` for recoverable errors. They surface to the UI in `AssessmentPanel` → Source Health → "errors". The last 5 are kept.
5. Use `ctx.config` (already validated against `configSchema`).

## Anatomy of a poller — `nws-alerts.ts`

```ts
export const nwsAlerts = defineConnector<z.infer<typeof Cfg>>({
  id: "nws-alerts",
  label: "NWS Weather Alerts",
  // …
  configSchema: Cfg,          // area + minSeverity
  defaultConfig: { area: "", minSeverity: "Minor" },
  pollIntervalMs: 60_000,
  async run(ctx) {
    const seen = new Set<string>();              // dedupe across polls
    while (!ctx.signal.aborted) {
      try {
        const url = new URL("https://api.weather.gov/alerts/active");
        if (ctx.config.area) url.searchParams.set("area", ctx.config.area);
        const r = await fetch(url, {
          headers: { "User-Agent": "overwatch/0.1 (demo)" },
          signal: ctx.signal,
        });
        if (!r.ok) throw new Error(`NWS ${r.status}`);
        const data = await r.json();
        for (const f of data.features ?? []) {
          if (!f.id || seen.has(f.id)) continue;
          seen.add(f.id);
          // … severity filter, centroid extraction …
          ctx.emit({ id: f.id, category: "weather", severity, title, summary,
                     occurredAt, geo, geoMentioned, url, icon: "cloud-lightning", payload });
        }
      } catch (e: any) {
        if (ctx.signal.aborted) return;
        ctx.log(`nws error: ${e.message ?? e}`);
      }
      await sleep(ctx.pollIntervalMs ?? 60_000, ctx.signal);
    }
  },
});
```

Pattern points to lift:
- **Dedupe with a `Set<string>`** keyed on the upstream's stable ID. The orchestrator dedupes by `id` inside SQLite, but a per-iteration set saves work and avoids re-emitting on a slow consumer.
- **`headers: { "User-Agent": "overwatch/0.1 (demo)" }`** — the NWS API rate-limits user-agent-less requests. The same UA is set in `packages/connectors/src/util.ts → fetchJson/fetchText` helpers.
- **Severity mapping** is the connector's job. Map upstream conventions to `"info" | "low" | "moderate" | "high" | "extreme"`.
- **Centroid extraction** for polygons/multipolygons lives inline (`extractCentroid()`) rather than in a shared util — connectors should be self-contained.

## Anatomy of a streaming/subscriber — `mqtt-generic.ts`

```ts
async run(ctx) {
  return new Promise<void>((resolve) => {
    const client = mqtt.connect(ctx.config.url, {
      username: ctx.config.username || undefined,
      password: ctx.config.password || undefined,
      reconnectPeriod: 3000,
      rejectUnauthorized: false,
    });
    const cleanup = () => { try { client.end(true); } catch {} resolve(); };
    ctx.signal.addEventListener("abort", cleanup);
    client.on("connect", () => {
      for (const t of ctx.config.topics) client.subscribe(t, { qos: 0 });
      ctx.log(`mqtt connected ${ctx.config.url}`);
    });
    client.on("error", (e) => ctx.log(`mqtt error: ${e.message}`));
    client.on("message", (topic, payload) => {
      const data = tryParseJson(payload.toString());
      ctx.emit({ id: `mqtt-${topic}-${Date.now()}-…`, category: ctx.config.category, … });
    });
  });
}
```

Pattern points:
- **`return new Promise(resolve => …)` and resolve on abort.** This is the streaming equivalent of the polling while-loop.
- **The subscriber owns its own retry semantics.** `mqtt.connect`'s `reconnectPeriod` handles transient network drops.
- **Permissive payload parsing** — try JSON, fall back to the raw string. MQTT brokers carry both.

## Anatomy of a webhook receiver — `webhook.ts`

```ts
declare global {
  var __overwatchWebhookRouter: Map<string, (body: any) => void> | undefined;
}

export function getWebhookRouter() {
  if (!globalThis.__overwatchWebhookRouter) globalThis.__overwatchWebhookRouter = new Map();
  return globalThis.__overwatchWebhookRouter;
}

async run(ctx) {
  const router = getWebhookRouter();
  router.set(ctx.config.key, (body) => {
    ctx.emit({ id: `wh-…`, category: ctx.config.category, …, payload: body });
  });
  await new Promise<void>((r) => ctx.signal.addEventListener("abort", () => r()));
  router.delete(ctx.config.key);
}
```

The Fastify route `POST /ingest/:key` (`apps/fabric/src/index.ts`) looks up the registered handler and calls it. Multiple webhook connectors can register different `key`s simultaneously.

## Adding a new connector

1. Create `packages/connectors/src/sources/your-source.ts`. Define `Cfg` (Zod), call `defineConnector({...})`, export it.
2. In `packages/connectors/src/index.ts`:
   - `import { yourSource } from "./sources/your-source.js";`
   - Re-export it.
   - Append it to `ALL_CONNECTORS`.
3. *(Optional)* In `scripts/seed-demo.ts`, add a default instance so `pnpm seed` picks it up.
4. `pnpm typecheck` from the repo root.
5. The fabric will pick up the new entry on next start and `GET /api/connectors/catalog` will include it. The connectors page shows it immediately (auto-refreshes every 5s).

`apps/fabric/src/index.ts → extractFields()` reads your `Cfg` schema and produces a `configFields[]` array (with `kind: "string"|"number"|"boolean"|"enum"|"array"|"object"|"record"|"tuple"`). The `/connectors` page renders the form fields automatically. As long as your Zod schema uses primitive shapes, no UI work is needed.

## Utilities — `packages/connectors/src/util.ts`

- `sleep(ms, signal)` — abortable sleep. Use this between polls.
- `fetchJson(url, init)` / `fetchText(url, init)` — `fetch` with a UA header pre-applied; throws on non-2xx.
- `km(a, b)` — haversine distance between two geo points. Reused by `apps/fabric/src/threatcon.ts` and `apps/fabric/src/alerts.ts`.

These are deliberately small. Most connectors only use `sleep` and call `fetch` directly.

## Connectors and severity — a cheat sheet

| Severity | Approximate meaning | Examples |
|---|---|---|
| `info` | Routine, not actionable | ISS pings, `simulator` heartbeats, every aircraft vector |
| `low` | Notable but minor | Small earthquakes (<3.5), low-mag NWS alerts |
| `moderate` | Worth attention | M3.5–4.9 quakes, moderate AQI, motion CV detections |
| `high` | Likely actionable | Severe NWS alerts, fires near a Location, M5–5.9 quakes |
| `extreme` | Emergency-grade | Extreme NWS alerts, M6+ quakes, geomagnetic storms |

These mappings are connector-specific and not centralised. Search `severity:` in `packages/connectors/src/sources/*.ts` for the per-source rules.

## Observability

Each instance's runtime is exposed via `GET /api/connectors/status` (and the WebSocket `status` envelope). Fields:

```ts
{
  id, label, category, authKind,
  enabled,                // user-set
  connected,              // true while run() is between calls to ctx.log/error
  lastEventAt,
  eventsLastMinute, eventsLastHour,
  errors: [],             // last 5 messages from ctx.log()
  configured: true,
}
```

`eventsLastMinute` / `eventsLastHour` are computed in `apps/fabric/src/orchestrator.ts → allStatus()` from a per-instance ring buffer of timestamps.
