# `@overwatch/connectors` — pluggable data sources

23+ connector definitions that produce `IngestEvent` streams. Each
connector is a `ConnectorDef` registered in `src/index.ts`'s
`ALL_CONNECTORS` array; the fabric orchestrator instantiates them
based on persisted user config.

**Test**: `pnpm --filter @overwatch/connectors test`

---

## Connector contract

```ts
export type ConnectorDef<Cfg> = {
  id: string;                  // stable kebab-case identifier
  label: string;               // human display
  description: string;         // 1–2 sentence summary
  category: ConnectorCategory; // weather / seismic / social / ...
  authKind: "none" | "api-key" | "oauth" | "bearer";
  homepageUrl?: string;
  freeTier?: boolean;
  defaults: Partial<Cfg>;
  configSchema: ZodSchema<Cfg>;
  configFields: ConfigFieldDef[];
  start: (cfg: Cfg, emit: (e: IngestEvent) => void) => { stop: () => void };
};
```

`start()` returns a `stop()` for the orchestrator to call on shutdown
or reconfig. Inside `start`, set up your poll loop / WS subscription /
MQTT client and call `emit(event)` for each ingested event.

---

## Registered connectors

| Category | id | Source |
|---|---|---|
| Weather | `nws-alerts` | NWS CAP/GeoJSON |
| Weather | `open-meteo` | Open-Meteo |
| Weather | `noaa-swpc` | NOAA Space Weather |
| Seismic | `usgs-quakes` | USGS |
| Seismic | `emsc` | EMSC |
| Earth | `nasa-eonet` | NASA EONET |
| Earth | `nasa-firms` | NASA FIRMS wildfires |
| Air | `openaq` | OpenAQ |
| Aviation | `opensky` | OpenSky Network |
| Aviation | `iss-location` | ISS API |
| Space | `spacex-launches` | SpaceX API |
| Social | `gdelt` | GDELT |
| Social | `hackernews` | HN Firebase |
| Social | `reddit` | reddit JSON |
| Social | `wikipedia-rc` | Wikipedia RecentChanges SSE |
| Social | `github-events` | GitHub public events |
| Crypto | `coingecko` | CoinGecko |
| Generic | `rss` | Any RSS feed |
| Generic | `rest-poller` | Polled REST endpoint |
| Generic | `webhook` | Inbound HTTP POST endpoint |
| Generic | `mqtt-generic` | MQTT topic subscription |
| Demo | `demo-simulator` | Synthetic event stream |
| Drone | `drone-rf` | Drone RF heuristic classifier |

Run `curl http://localhost:4311/api/connectors/catalog | jq` against
a running fabric to enumerate the live registry.

---

## Adding a connector

1. Create `src/sources/<name>.ts` exporting a `ConnectorDef`.
2. Register it in `src/index.ts`'s `ALL_CONNECTORS` array.
3. If the connector needs new event types, extend the `EventCategory`
   enum in `@overwatch/schemas` (also bump the discriminated union if
   you add a new `kind`).
4. Add a smoke test under `packages/connectors/*.test.ts` that exercises
   `configSchema.parse(defaults)` and (if mockable) `start` end-to-end.

---

## Notes for agents

- Polling intervals: respect free-tier rate limits. Most pollers default
  to 30s–5min — see `defaultConfig`.
- API keys: never log them. The fabric encrypts persisted configs with
  AES-256-GCM; in-memory configs should not be serialized to events
  or logs.
- Some connectors emit GeoJSON-ish events that need `location` mapped
  to `EventLocation` (lat/lon). Use `util.toEventLocation()`.
- `drone-rf` is the only connector with a real-time correlation
  contract — its events feed `DroneAggregator` in fabric; see
  `apps/fabric/src/drone.ts`.
