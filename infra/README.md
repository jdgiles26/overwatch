# `infra/` — Docker + RTSP proxy

Production-shaped local dev via Docker Compose. Three services, one
named volume, one shared bridge network.

| File | What |
|---|---|
| `docker-compose.yml` | Orchestrates fabric + web + go2rtc |
| `Dockerfile.fabric` | Multi-stage build for the Fastify backend |
| `Dockerfile.web` | Multi-stage Next.js build (standalone output) |
| `go2rtc.yaml` | RTSP / WebRTC proxy config — translates RTSP cameras into browser-playable WHEP streams |

---

## Quickstart

```bash
cp .env.example .env       # optional — env file is sourced by compose
docker compose -f infra/docker-compose.yml up --build
# fabric on :4311, web on :3311, go2rtc on :1984 / :8555 (WebRTC ICE)
pnpm seed                   # seed demo data once stack is up
```

`web` waits for `fabric` to pass a healthcheck (`GET /health`) before
starting, so the browser will not hit a connection-refused on the
first request.

### Pointing the browser at a non-default fabric

`NEXT_PUBLIC_*` values are inlined into the web bundle at **build time**
by Next.js, not read at runtime. Override them as build args (compose
already wires them through):

```bash
NEXT_PUBLIC_FABRIC_URL=http://fabric.local:4311 \
NEXT_PUBLIC_FABRIC_WS=ws://fabric.local:4311 \
NEXT_PUBLIC_GO2RTC_URL=http://fabric.local:1984 \
docker compose -f infra/docker-compose.yml build web
```

---

## Volumes & state

| Volume | Mounted at | Purpose |
|---|---|---|
| `overwatch_data` | `/data` (inside fabric container) | Persists `overwatch.db*` and `key.bin` across restarts |

Back up `overwatch.db` and `key.bin` together. Losing the key makes
every encrypted connector config in the DB unreadable.

---

## Ports

| Port | Service |
|---|---|
| `3311` | web (Next.js) |
| `4311` | fabric (Fastify + WS) |
| `1984` | go2rtc HTTP API + WHEP |
| `8555/tcp` | go2rtc WebRTC (TCP fallback) |
| `8555/udp` | go2rtc WebRTC (preferred) |

Change these in `docker-compose.yml`; if you change the fabric port,
also rebuild `web` with a matching `NEXT_PUBLIC_FABRIC_WS` build arg.

---

## `go2rtc` and RTSP cameras

`go2rtc.yaml` declares named streams. Two demo streams ship by default
(`bigbuckbunny`, `road-cam`); add your own RTSP cameras as:

```yaml
streams:
  my-rtsp: rtsp://user:pass@192.168.1.50:554/stream
```

The web app references streams by name via the camera config
(`whepUrl: http://localhost:1984/api/whep?src=my-rtsp`). Sub-500 ms
latency is achievable over WebRTC.

---

## Notes for agents

- `go2rtc` previously used `network_mode: host`, which Docker Desktop
  on macOS silently ignores. It now publishes `1984/tcp` and
  `8555/tcp+udp` explicitly so the documented ports work on every host.
- Both Dockerfiles run `pnpm install --frozen-lockfile=false`; if you
  change the lockfile, rebuilds pick up the new graph without
  `--no-cache`. Pin to `--frozen-lockfile` only after wiring CI lock
  verification.
- `NEXT_PUBLIC_*` env vars must be passed as **build args** to the
  `web` service, not runtime env — Next.js inlines them into the
  bundle at compile time.
- Don't bake secrets into Dockerfiles. Connector API keys go through
  the fabric's encrypted at-rest store.
