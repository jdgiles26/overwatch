---
name: run-overwatch
description: Run the Overwatch stack (fabric + web + go2rtc) and drive it programmatically. Use when the user asks to start, launch, run, build, boot, screenshot, smoke-test, or verify the Overwatch app, the dashboard, the globe, or the fabric API. Stack is Docker Compose; driver is a Puppeteer script that loads the dashboard in headless Chrome and confirms the Cesium globe mounts.
---

# run-overwatch

Overwatch is a pnpm monorepo with two apps (`apps/fabric` Fastify API on `:4311`, `apps/web` Next.js dashboard on `:3311`) and a third-party RTSP→WebRTC proxy (`go2rtc`). They run together as a Docker Compose stack. The "did it work?" oracle is the **Cesium 3D globe**: if it mounts and `/fabric/api/cameras` returns `200` through the Next.js rewrite, the bundle pipeline, the proxy config, and the DB are all healthy.

> **All paths in this file are relative to the repo root** (`<unit>/`). The driver itself lives at `.claude/skills/run-overwatch/driver.mjs`.

## Prerequisites

- macOS with Docker Desktop running. (The driver uses macOS's Chrome at `/Applications/Google Chrome.app/...`; override with `CHROME_PATH=` for other OSes.)
- Node ≥ 20 and pnpm ≥ 11 on host (only needed for `pnpm verify` and the driver; the stack itself runs in containers).
- Free ports: `3311` (web), `4311` (fabric). `1984` (go2rtc) is internal-only by default.

```bash
# Verified versions used to author this skill
node --version    # v24.14.0
pnpm --version    # 11.2.2
docker --version  # Docker Desktop 4.x
```

## Build

```bash
# From repo root — first time only, or after any code change in apps/*
docker compose -f infra/docker-compose.yml build
```

Build args matter: `infra/docker-compose.yml` passes `FABRIC_URL=http://fabric:4311` into the web build so Next.js's `rewrites()` proxy resolves to the compose-internal service. Don't strip that.

If you change `apps/web/src/**` or `apps/fabric/src/**`, rebuild the affected service: `docker compose -f infra/docker-compose.yml build web` or `… build fabric`. Source is NOT bind-mounted.

## Run — agent path (DO THIS)

```bash
# 1. Bring the stack up (idempotent; recreates only if config changed)
docker compose -f infra/docker-compose.yml up -d

# 2. Wait for fabric to report healthy
until docker compose -f infra/docker-compose.yml ps fabric --format '{{.Status}}' | grep -q healthy; do sleep 1; done

# 3. One-time: install the driver's puppeteer-core (isolated from workspace)
cd .claude/skills/run-overwatch && pnpm install --ignore-workspace && cd -

# 4. Drive the UI
node .claude/skills/run-overwatch/driver.mjs health         # curl smoke
node .claude/skills/run-overwatch/driver.mjs ui             # globe + screenshot → .claude/skills/run-overwatch/out/ui.png
node .claude/skills/run-overwatch/driver.mjs console        # dump browser console + pageerrors
node .claude/skills/run-overwatch/driver.mjs ports          # who's bound to 4311/3311/1984
```

`ui` exits non-zero if any `pageerror` fires or if `window.Cesium` / `window.__cesiumViewer` / a canvas inside `[data-agent="map-3d"]` is missing. Treat the screenshot as the oracle — **open it**. A "passed" run with a blank screenshot means you launched into an error page and nothing fired pageerror.

Verified output (last run authoring this skill):

```
$ node .claude/skills/run-overwatch/driver.mjs health
PASS  200  http://localhost:4311/health  → 200
PASS  200  http://localhost:4311/api/cameras  → 200
PASS  200  http://localhost:3311/  → 200
PASS  200  http://localhost:3311/fabric/api/cameras  → 200
PASS  200  http://localhost:3311/fabric/api/locations  → 200
all health checks passed

$ node .claude/skills/run-overwatch/driver.mjs ui
status: {"cesium":true,"version":"1.140.0","viewer":true,"canvases":1}
screenshot: .../out/ui.png
UI smoke passed
```

## Run — human path

```bash
docker compose -f infra/docker-compose.yml up -d
open http://localhost:3311        # macOS
docker compose -f infra/docker-compose.yml down   # when done
```

Useful only when you want to click around. Headless? Use the driver.

## Local dev (without Docker)

Only needed when iterating on `apps/fabric` or `apps/web` source and you don't want the rebuild cycle.

```bash
pnpm install
pnpm --filter @overwatch/fabric dev   # :4311 with tsx watch
pnpm --filter @overwatch/web dev      # :3311
pnpm seed                             # populate demo cameras + locations
```

Then point the driver at it the same way — same ports.

## Direct invocation (skip the UI)

Most fabric work doesn't need the browser. Hit the API directly:

```bash
curl -s http://localhost:4311/api/threatcon | jq .
curl -s http://localhost:4311/api/cameras   | jq .
curl -s http://localhost:4311/api/briefing-context | jq '.eventCount,.threatcon'
```

Per-package tests stay fast and isolated:

```bash
pnpm --filter @overwatch/fabric test       # 89 tests
pnpm --filter @overwatch/web test          # 102 tests
pnpm --filter @overwatch/connectors test   # 5 tests
pnpm verify                                # typecheck + lint + 15 drift assertions
```

## Gotchas

These are the traps that ate hours; they don't reproduce until you do the exact thing that triggers them.

- **The driver's `pnpm install` MUST use `--ignore-workspace`.** Plain `pnpm install` in `.claude/skills/run-overwatch/` walks up to the repo's `pnpm-workspace.yaml`, sees the skill dir isn't a member, and silently installs nothing for it. You'll get `Cannot find package 'puppeteer-core'` at first `node driver.mjs` invocation. Use `pnpm install --ignore-workspace` from within the skill dir.

- **Cesium 1.140 is loaded via UMD, not webpack.** `apps/web/next.config.mjs` externalizes `cesium` and `apps/web/src/app/layout.tsx` injects `<Script id="cesium-umd" src="/cesium/Cesium.js" strategy="beforeInteractive">`. The bundled webpack chunks contain `\00` legacy octal escapes inside template literals that V8 rejects in strict mode (ES modules) → `SyntaxError: Octal escape sequences are not allowed in template strings` → ChunkLoadError → no globe. Use `loadCesium()` from `apps/web/src/lib/cesium.ts`, never `await import("cesium")` in client code. Drift assert `cesium-externalized` + `no-direct-cesium-imports` enforce this.

- **`FABRIC_URL` is baked at web build time, not read at runtime.** `next.config.mjs#rewrites()` runs during `next build` and freezes the proxy target. If the web image is built without `--build-arg FABRIC_URL=http://fabric:4311` (the compose default), every `/fabric/api/*` returns 500 ECONNREFUSED at runtime because it tries to reach `localhost:4311` from inside the container. Compose passes it; standalone `docker build` callers must.

- **Dockerfile pnpm version must match root `packageManager`.** Pinning `pnpm@10.x` in the Dockerfile while root says `pnpm@11.x` triggers pnpm 11's deps-status check on every container start. It tries to wipe + reinstall `node_modules`, fails with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`, and the container crash-loops. Drift assert `dockerfile-pnpm-matches-packagemanager` catches this.

- **Source is NOT bind-mounted in compose.** Editing `apps/web/src/**` does nothing until you `docker compose build web` and recreate. The `dev` workflow above bypasses this.

- **`docker compose down` cleanly stops fabric in ~1s** because fabric handles `SIGTERM` (see `apps/fabric/src/index.ts`). Older builds without that handler waited 10s for `SIGKILL`. If `compose stop` ever starts taking ~10s, you've regressed the SIGTERM handler — drift assert `fabric-handles-sigterm` should also fail.

- **`go2rtc` is internal-only in compose.** `lsof -iTCP:1984` will show nothing listening on the host — that's correct. The web container reaches it at `http://go2rtc:1984` over the compose network. The `ports` driver subcommand will print `(nothing listening)` for `:1984` and that's expected.

- **Headless Chrome service-worker state carries between runs.** The driver uses `browser.createBrowserContext()` (incognito) for a clean slate. If you write your own probe with `browser.newPage()` directly, a stale `overwatch-shell-v2` SW from a prior run can serve old JS. Use incognito or clear `~/Library/Application Support/Google/Chrome` for that profile.

- **`fabric` re-seeds the connector instances on first boot only.** Wiping `apps/fabric/data/overwatch.db` between runs means re-running `pnpm seed` (or your own seed). The DB and the AES key (`data/key.bin`) are persisted to a named volume; lose the key and previously-stored connector configs become permanently unreadable.

## Troubleshooting

Symptom → fix. Only things that actually happened during real work.

- **`UI smoke failed` with no errors above it.** Read the screenshot. If it's the dashboard with no globe (white center where the globe should be), `window.__cesiumViewer` was set but the canvas didn't attach yet — bump the `waitForFunction` timeout in `driver.mjs#ui`. If it's a Next.js error page, `node driver.mjs console` will show the real exception.

- **`pageerror: SyntaxError: Octal escape sequences are not allowed in template strings`.** Cesium UMD externalization is broken. `pnpm drift` will fail `cesium-externalized` or `no-direct-cesium-imports` — fix per the gotcha above.

- **`pageerror: ChunkLoadError`** with the same error nested. Same root cause as octal escape — chunk fails to parse → fails to load → ChunkLoadError. Fix Cesium, not chunk loading.

- **`/fabric/api/*` returns `500` with `ECONNREFUSED ::1:4311`.** Web image was built without `FABRIC_URL` arg. Rebuild: `docker compose -f infra/docker-compose.yml build web && docker compose -f infra/docker-compose.yml up -d web`.

- **fabric container crash-loops with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`.** Dockerfile pnpm version drifted from root. `pnpm drift` will fail `dockerfile-pnpm-matches-packagemanager`.

- **`Cannot find package 'puppeteer-core'`** when running the driver. You ran `pnpm install` without `--ignore-workspace`. Re-run inside `.claude/skills/run-overwatch/` with the flag.

- **Driver hangs on `goto`.** Web container isn't healthy yet. Check `docker compose -f infra/docker-compose.yml ps`; fabric must report `(healthy)` before web is useful.

- **`Analyst chat` returns `ERROR_CODE: 1 ... Subgraph output (logits)`.** ONNX Runtime rejected the chosen model's quantized export. The pipeline loader already auto-falls-back through dtypes (fp16 → q4 → q8) and surfaces a toast if all fail. If you keep hitting it, pick `HuggingFaceTB/SmolLM2-360M-Instruct` from the dropdown — that one's a clean export.

## When you break this skill

If you change any of:

- Cesium loading mechanism in `apps/web` (externals, UMD script tag, `loadCesium()` helper)
- `FABRIC_URL` build-arg threading in `infra/Dockerfile.web` or `infra/docker-compose.yml`
- The `[data-agent="map-3d"]` selector in `apps/web/src/components/Map3D.tsx`
- Pnpm version pinning in either Dockerfile
- fabric's `/health` endpoint or SIGTERM handler

…run `pnpm drift` AND `node .claude/skills/run-overwatch/driver.mjs ui` after your change. The 15-assertion drift check covers the source-side regressions; the driver catches anything that requires a running browser.
