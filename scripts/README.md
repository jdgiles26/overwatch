# `scripts/` — repo-level utility scripts

TypeScript scripts run via `tsx` from the repo root.

| Script | What it does | Invocation |
|---|---|---|
| `seed-demo.ts` | Seeds a running fabric with 3 locations, 3 cameras, and 15 demo connector instances | `pnpm seed` (fabric must be running on :4311) |
| `demo-drone-server.ts` | Local UDP server that emits simulated drone RF frames (for offline dev) | `pnpm tsx scripts/demo-drone-server.ts` |
| `smoke-drone.ts` | Automated end-to-end smoke test of the drone-RF → DroneAggregator → WS pipeline | `pnpm tsx scripts/smoke-drone.ts` |

---

## `seed-demo.ts`

Posts to `/api/connectors/instances`, `/api/locations`, and
`/api/cameras` on the running fabric. Idempotent in spirit but creates
new instances each run — re-run on a clean DB (see root README for
DB rotation).

The connectors it seeds are a subset of the 23-connector catalog;
edit the script to add more if you need different demo data.

## `smoke-drone.ts`

Boots a fresh in-memory fabric instance, pipes simulated RF events,
and asserts the expected `drone-track` and `drone-classification` WS
messages arrive in order. Run this whenever you change `drone.ts` or
the drone-rf connector.

---

## Notes for agents

- Scripts assume `tsx` is hoisted (it's a root devDep). If `tsx` is
  missing, run `pnpm install` first.
- Demo scripts hit `http://localhost:4311` by default; override with
  `FABRIC_URL=...`.
- Don't add scripts that mutate prod state without a `--confirm` flag
  and a dry-run mode.
