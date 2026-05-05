# Debugging

The honest caveat first: there are no tests in this repo (see [testing](./testing.md)). The implicit verification path is `pnpm typecheck`, then `pnpm dev`, then click around. Most failures are infrastructure (port collisions, missing native modules, Cesium asset 404s) rather than logic. This page enumerates the common ones.

## Typecheck per workspace

The fastest signal that something is broken:

```bash
pnpm typecheck                              # all workspaces
pnpm --filter @overwatch/fabric typecheck   # fabric only
pnpm --filter @overwatch/web typecheck      # web only
```

The strict TypeScript settings (`strict: true`, `noUncheckedIndexedAccess: true` in `tsconfig.base.json`) catch real bugs:

- Missing optional chains on array access (`data[i]` requires `?? fallback` or `data[i]!`).
- Missing schema fields after editing `packages/schemas/src/index.ts`.
- Type drift between fabric and web after a schema change.

If `pnpm typecheck` is clean and the dev server still won't run, the problem is runtime. Read on.

## The Next.js dev overlay (Next 15)

`pnpm --filter @overwatch/web dev` ships with the Next 15 dev overlay. It pops a red banner for any uncaught error in client code and surfaces compile errors with file/line numbers.

Important quirk: **Next 15 escalates every `console.error` into a red error toast.** That's why `apps/web/src/lib/ai.ts` installs a `console.error` filter (`installConsoleFilter()`) to silence ORT's chatty `VerifyEachNodeIsAssignedToAnEp` and friends. They're informational, not failures.

To see the suppressed messages during debugging:

```js
// in DevTools console
localStorage.debug = "*";
console.debug; // search for "[ort]" prefixed lines
```

Or temporarily edit `apps/web/src/lib/ai.ts` to skip `installConsoleFilter()`.

## Inspect the SQLite DB

```bash
sqlite3 apps/fabric/data/overwatch.db
```

Useful queries:

```sql
.schema
.tables                                           -- 7 tables: events, connector_instances, cameras, locations, alert_rules, alert_firings, aois

-- 10 most recent events
SELECT id, category, severity, title FROM events ORDER BY received_at DESC LIMIT 10;

-- Event counts by category
SELECT category, COUNT(*) FROM events GROUP BY category ORDER BY 2 DESC;

-- All connector instances (config is encrypted; ignore that column)
SELECT id, connector_id, label, enabled FROM connector_instances;

-- Recent alert firings
SELECT id, rule_label, fired_at, reason FROM alert_firings ORDER BY fired_at DESC LIMIT 20;

-- All saved Locations
SELECT * FROM locations;
```

Schema reference: [reference/data-models § sqlite tables](../reference/data-models.md#sqlite-tables).

The `connector_instances.config` column is base64(`iv12 || tag16 || ciphertext`) AES-256-GCM, decrypted in `apps/fabric/src/db.ts:decrypt()`. Don't try to read it directly; query through the orchestrator instead.

## Tail fabric logs

The fabric uses Fastify's pino logger at level `info`. Logs go to stdout.

When running locally:

```bash
pnpm --filter @overwatch/fabric dev | tee fabric.log
```

When running in Docker:

```bash
docker compose -f infra/docker-compose.yml logs -f fabric
```

What to look for:

- `fabric listening on 4311` — startup completed.
- `[orchestrator] launched <connector-id> (<instance-id>)` — connector started.
- Connector errors surface via `ctx.log()` and into the WebSocket `status` envelope (`errors[]`); they don't always print at info level. Check `GET /api/connectors/status` for an authoritative list.

## Debug WebSocket envelopes

The simplest tool is [`websocat`](https://github.com/vi/websocat):

```bash
brew install websocat                          # macOS
websocat -t ws://localhost:4311/ws | jq -c .
```

You'll see (in order, immediately after connect):

```json
{"type":"hello","data":{"sessionId":"...","ts":"..."}}
{"type":"snapshot","data":{"events":[...200 items...]}}
{"type":"status","data":[...connector statuses...]}
{"type":"rules","data":[...alert rules...]}
```

Then, every 15s:

```json
{"type":"threatcon","data":{...}}
{"type":"pir","data":[...]}
```

And whenever a connector emits:

```json
{"type":"event","data":{...IngestEvent...}}
```

And whenever a rule fires:

```json
{"type":"alert","data":{...AlertFiring...}}
```

If you only want a specific envelope type:

```bash
websocat -t ws://localhost:4311/ws | jq -c 'select(.type=="event")'
```

The full envelope schema is in `packages/schemas/src/index.ts → ServerToClient`. See [reference/configuration § websocket envelope types](../reference/configuration.md#websocket-envelope-types).

## Inspect connector errors via AssessmentPanel

Open `http://localhost:3311` and look at the right rail. The `AssessmentPanel.tsx` Source Health card lists every instance with a pulse dot:

- Green = `connected: true`.
- Grey = `connected: false`.
- The instance row expands to show the last 5 errors from `ctx.log()`.

The same data is at `GET http://localhost:4311/api/connectors/status`:

```bash
curl -s http://localhost:4311/api/connectors/status | jq '.[] | select(.connected == false) | {id: .id, errors: .errors}'
```

If a connector is stuck at `connected: false`, check:
1. The `errors` array — it's the last 5 messages from `ctx.log()`.
2. Whether the upstream API is reachable: `curl <url>` from the same host.
3. Whether the API key is set if it's an `api-key` connector.

To restart a single instance, toggle it off and on at `/connectors`, or `PATCH /api/connectors/:id` with `{ enabled: false }` then `{ enabled: true }`. The orchestrator aborts and re-launches the `run()` loop.

## Debug WebGPU / transformers.js

The Analyst panel logs progress via the `onProgress` callback that ends up on the panel's status line. To see what's actually happening at the ORT level:

1. The `installConsoleFilter()` in `apps/web/src/lib/ai.ts` re-routes ORT noise to `console.debug`. Open DevTools → Console → enable "Verbose" log level. The lines prefixed `[ort]` are the suppressed-but-still-logged ORT messages.
2. To force WASM (skip WebGPU): the LLM falls back automatically on init failure, but you can also click *Use WASM* in the Analyst panel.
3. To see model download progress: DevTools → Network → filter on `huggingface.co`. Each `.onnx` shard is a separate request; cached after first load via the browser cache.

If the Analyst stays stuck on "Loading…":

- Check the device badge. `webgpu` requires `navigator.gpu.requestAdapter()` to succeed; the COOP/COEP headers in `apps/web/next.config.mjs` are required for that to even be attempted.
- Check Network for `model.onnx`-style 404s. The model name in `AnalystPanel.tsx` (`HuggingFaceTB/SmolLM2-360M-Instruct` and friends) must exist on the HF CDN.
- Check console for `Failed to construct 'WebAssembly.Memory'` — this means SharedArrayBuffer is unavailable. COOP/COEP must be set; verify with DevTools → Network → Headers on the dashboard URL.

## Cesium asset 404s

`apps/web/src/components/Map3D.tsx` sets `window.CESIUM_BASE_URL` to the official Cesium CDN path:

```ts
(window as any).CESIUM_BASE_URL =
  "https://cesium.com/downloads/cesiumjs/releases/1.125/Build/Cesium/";
```

If you see 404s on `Workers/cesiumWorkerBootstrapper.js`, `Assets/Textures/...`, or similar, the version in the URL has drifted from the installed `cesium` package version (`^1.125.0` in `apps/web/package.json`). Bumping the package without updating the CDN path is the most common cause.

## Map3D blank globe

The Cesium 3D globe rendering blank or dark is usually one of:

| Cause | Fix |
|---|---|
| `CESIUM_BASE_URL` mismatch (above) | Match the URL to the installed package version. |
| COOP/COEP not set | Verify in DevTools → Network → page request → Response Headers. The `apps/web/next.config.mjs` must be deployed. |
| Ion token misconfigured | If `NEXT_PUBLIC_CESIUM_ION_TOKEN` is set but invalid, Cesium will fail to load the Ion default imagery. Unset to fall back to OSM, or fix the token. |
| WebGL context lost | DevTools → Console will say so. Reload the page. |
| `preserveDrawingBuffer: false` somewhere | The `contextOptions: { webgl: { preserveDrawingBuffer: true, alpha: true } }` in `Map3D.tsx` is required so the Overseer can `canvas.toBlob()` for screenshots. Restoring it fixes screenshot-related failures. |

The OSM fallback layer is added in `Map3D.tsx` regardless of the Ion token, so a blank globe is almost always one of the first three rows.

## Camera tile WHEP 404s

WHEP playback requires the `go2rtc` sidecar.

Symptoms: the camera tile shows `WHEP 404` or `connection failed`.

Checks:

1. Is go2rtc running? `curl http://localhost:1984/api/streams`. The default `infra/go2rtc.yaml` lists `bigbuckbunny` and `road-cam`.
2. Does the stream name in the camera config match a key in `infra/go2rtc.yaml`? The seed script creates a `Demo: Big Buck Bunny` camera that points at the `bigbuckbunny` stream — these names must match exactly.
3. Is `NEXT_PUBLIC_GO2RTC_URL` set correctly? It defaults to `http://localhost:1984`. Inside the docker-compose `web` container it's also `http://localhost:1984` because the WHEP request originates in the *browser*, not the container.
4. Is `go2rtc` running with `network_mode: host`? Required on macOS so WebRTC ICE candidates (`host:8555`) bind on a routable interface.

If go2rtc is running but the stream is missing, edit `infra/go2rtc.yaml` and `docker compose restart go2rtc`. The streams config is read on go2rtc startup.

## better-sqlite3 native rebuild errors

The fabric depends on `better-sqlite3@^11.7.0`, a native module. Common errors and fixes:

- **`gyp: No Xcode or CLT version detected!` (macOS)** — `xcode-select --install`.
- **`Python.h: No such file or directory` (Linux)** — `apt-get install python3 build-essential`. The fabric Dockerfile already does this.
- **Built against the wrong Node version** — usually after switching Node versions. Run `pnpm rebuild better-sqlite3` from the repo root.
- **`Module did not self-register` / `MODULE_NOT_FOUND`** — the prebuilt binary failed to load. Force a rebuild: `pnpm install --force` or delete `node_modules` and reinstall.

The fabric Dockerfile (`infra/Dockerfile.fabric`) sidesteps all of this by installing build deps and pinning `node:22-bookworm-slim`.

## Common port collisions

Defaults: web on `3311`, fabric on `4311`, go2rtc on `1984` and `8555`.

```bash
# What's holding the port (macOS / Linux)
lsof -iTCP:4311 -sTCP:LISTEN
lsof -iTCP:3311 -sTCP:LISTEN
```

To change ports: set `FABRIC_PORT` for the fabric, or pass `-p <port>` to `next dev` / `next start`. Don't forget to also update `NEXT_PUBLIC_FABRIC_WS` and `FABRIC_URL` if you change `FABRIC_PORT`.

## When the `/connectors` page shows nothing

Symptoms: `/connectors` page renders an empty list.

Checks:

1. `curl -s http://localhost:4311/api/connectors/catalog | jq 'length'` should return 22 (or more if you added connectors).
2. `curl -s http://localhost:4311/api/connectors/status | jq 'length'` should return however many instances are running.
3. If `status` returns 0, you haven't seeded yet — run `pnpm seed`.
4. If `catalog` returns less than 22, a connector is missing from `packages/connectors/src/index.ts:ALL_CONNECTORS`.

## When desktop notifications don't fire

Alert sounds always work (WebAudio); desktop notifications require browser permission.

1. Click the bell icon or trigger an alert manually. The browser will prompt for Notification permission.
2. If you blocked it, reset via DevTools → Application → Storage → Clear site data, or via the address-bar lock icon.
3. Check that the rule's `notify.desktop` is true. Default is true; set in `apps/fabric/src/index.ts:POST /api/rules` if absent.

## When Overseer just sits there

The agent loop is `await import("@/lib/agent")` then `runOverseer({...})`. It pulls a model from HuggingFace and may take 5–60 seconds on the first run.

1. Check the AnalystPanel device badge — it tells you whether WebGPU or WASM is active. WASM on the agent's path is *very* slow.
2. Open DevTools → Network → filter on `huggingface.co` to see the download progress.
3. If the panel shows steps but `result: "no element data-agent=\"...\""`, the model is hallucinating target names. Compare with `rg 'data-agent='` to see what's actually in the DOM.

## A short failure-mode tour

| Symptom | Likely cause | First check |
|---|---|---|
| Dashboard shows "FABRIC OFFLINE" forever | Fabric not running, port mismatch, WebSocket URL wrong | `curl http://localhost:4311/health` |
| `/api/connectors/catalog` 404 | `FABRIC_URL` doesn't match | `echo $FABRIC_URL`; default is `http://localhost:4311` |
| Map3D blank | CESIUM_BASE_URL or COOP/COEP | DevTools → Network on `Widgets/widgets.css`; check headers |
| Map2D missing tiles | OSM rate-limited the host | Wait, or swap to a different `tile.openstreetmap.org` mirror |
| WHEP 404 in camera tile | go2rtc not running or stream name wrong | `curl http://localhost:1984/api/streams` |
| Analyst stuck on "Loading…" | WebGPU init failed silently | DevTools → Console with verbose level; look for `[ort]` lines |
| `pnpm seed` fails with `ECONNREFUSED` | Fabric not running yet | Run fabric first |
| `better-sqlite3` build fails | Missing native build chain | See `better-sqlite3 native rebuild errors` above |
| Alert rule never fires | Rule disabled, condition mismatch, or rate-limited | `GET /api/firings?limit=20`; check `lastFire` interval against `condition.rateLimitMs` |
| THREATCON stuck at 0 | No events in last 6h, or no Locations defined | `GET /api/events?limit=10`; `GET /api/locations` |

## Caveat: zero tests

Everything above is manual verification. There is no automated suite that catches regressions before they hit you in DevTools. See [testing](./testing.md) for the smallest reasonable layer the repo could adopt.

When you change something in `apps/fabric/src/threatcon.ts`, `apps/fabric/src/alerts.ts`, or any connector, the cycle is:

```bash
pnpm --filter @overwatch/fabric typecheck
pnpm --filter @overwatch/fabric dev          # watch logs
# trigger the path manually (curl, browser, websocat)
# observe; iterate
```

Until the testing layer is in place, this is the workflow.

## See also

- [development-workflow](./development-workflow.md) — the install / run / typecheck / build cycle.
- [testing](./testing.md) — the proposed first-test plan.
- [reference/configuration](../reference/configuration.md) — env variables, REST endpoints, WebSocket envelopes.
- [reference/deployment](../reference/deployment.md) — Docker stacks and go2rtc.
- [overview/getting-started § common first-run failures](../overview/getting-started.md#common-first-run-failures) — startup-specific issues.
