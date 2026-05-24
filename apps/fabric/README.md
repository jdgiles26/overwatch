# `apps/fabric` — backend ingestion + WebSocket hub

Fastify HTTP/WS server on `:4311`. Persists events to SQLite (encrypted
connector configs at rest), computes THREATCON, evaluates AlertRules,
correlates drone-RF tracks, and broadcasts everything to connected web
clients.

**Run**: `pnpm --filter @overwatch/fabric dev`
**Test**: `pnpm --filter @overwatch/fabric test`
**Port**: `FABRIC_PORT` env (default `4311`)

---

## Files

| File | Concern |
|---|---|
| `src/index.ts` | Fastify wiring: HTTP routes, WS `/ws` hub, broadcast loop, lifecycle |
| `src/db.ts` | `better-sqlite3` WAL mode; AES-256-GCM crypto for connector configs; tables: `events`, `locations`, `cameras`, `rules`, `firings`, `aois`, `connector_instances` |
| `src/orchestrator.ts` | Connector lifecycle manager — starts/stops/restarts connectors based on persisted enabled state; emits `event` and `status` |
| `src/threatcon.ts` | Derives THREATCON level (`nominal` → `critical`) and the 7 PIRs from recent events |
| `src/alerts.ts` | `RuleEngine.evaluate()` matches incoming events against persisted `AlertRule[]` and emits firings |
| `src/drone.ts` | `DroneAggregator.process()` correlates RF detections into stable tracks; emits `drone-track` and `drone-classification` |
| `src/rules.ts` | `normalizeRuleId()` — defensive id-handling for the `POST /api/rules` route. Empty / whitespace / non-string ids get a fresh `rule_<hex>` mint so new rules don't collide on `INSERT OR REPLACE`. |
| `src/correlation.ts` | Pure Pearson r kernel + `isSignificantCorrelation(threshold=0.7)` predicate. Foundation for the multi-session "real-world correlation + AI report" feature tracked in `future/IDEAS.md` #11. No I/O. |

Each non-trivial source file has a co-located `*.test.ts` (Vitest).

---

## Data flow

```
connector → orchestrator → broadcast → /ws clients
                      ↓
                   db.persistEvent
                      ↓
                  RuleEngine.evaluate → broadcast alert
                      ↓
                  DroneAggregator.process → broadcast drone-track
```

The `ServerToClient` discriminated union in `@overwatch/schemas` is the
contract for every WS message: `event` · `status` · `threatcon` · `pir` ·
`hello` · `snapshot` · `alert` · `rules` · `drone-track` ·
`drone-classification` · `cv-detection`.

---

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `FABRIC_PORT` | `4311` | HTTP/WS port |
| `OVERWATCH_DB` | `./data/overwatch.db` | SQLite path |
| `OVERWATCH_KEY_PATH` | `./data/key.bin` | AES-256-GCM key (auto-generated on first run, mode `0o600`) |

The DB and key are auto-generated on first start. They are gitignored;
each clone has its own. Losing `key.bin` makes encrypted connector
configs unreadable — see root `README.md` for rotation guidance.

---

## REST surface (selected)

| Route | Purpose |
|---|---|
| `GET /api/threatcon` | Current THREATCON level + 7 PIRs |
| `GET /api/connectors/catalog` | All 23 registered connectors with config schemas |
| `GET /api/connectors/instances` | Currently configured connector instances |
| `POST /api/connectors/instances` | Add a configured instance |
| `GET /api/events?limit=N` | Recent persisted events |
| `POST /api/cv-event` | CvEvent ingest from browser-side vision workers |
| `WS /ws` | Real-time `ServerToClient` stream |

The full route map is wired in `src/index.ts`; grep for `fastify.get`/
`fastify.post` to enumerate.

---

## Notes for agents

- The connector orchestrator persists *enabled* state but does NOT auto-
  restart connectors that fail at runtime. If you change connector
  semantics, also check `orchestrator.test.ts` for the restart path.
- `db.ts` uses prepared statements per query; the test file covers
  schema migration shape — modify migrations carefully and add a test.
- WebSocket broadcast is fire-and-forget; clients reconnect via
  `apps/web/src/lib/ws.ts` with exponential backoff. The `snapshot`
  message sent on connection replays current state.
- The DroneAggregator state lives in-memory and is rebuilt from recent
  events on restart; if you change track-correlation logic, run the
  smoke test in `scripts/smoke-drone.ts`.
