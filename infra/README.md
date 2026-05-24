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
| `1984` | go2rtc HTTP API |
| `8555` | go2rtc WebRTC (UDP) |

Change these in `docker-compose.yml`; if you change the fabric port,
also update `NEXT_PUBLIC_FABRIC_WS` for the web service.

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

- The compose file uses host networking for some ports; on macOS,
  `host` mode is not honored — the published ports above are what's
  reachable from your browser.
- Dockerfile.fabric runs `pnpm install --frozen-lockfile`; if you
  change the lockfile, the next `docker build` will fail without
  `--no-frozen-lockfile` or with stale cached layers — invalidate
  with `--no-cache` when needed.
- Don't bake secrets into Dockerfiles. Connector API keys go through
  the fabric's encrypted at-rest store.
