# Deployment reference

The default deployment is `docker compose up` against `infra/docker-compose.yml`. Three containers, one host network mode for go2rtc, one named volume for SQLite. There is no Helm chart, no Kubernetes manifest, no Terraform — see [overview/getting-started](../overview/getting-started.md) for the local-dev (no-Docker) path.

## docker-compose

`infra/docker-compose.yml`:

```yaml
version: "3.9"

services:
  fabric:
    build:
      context: ..
      dockerfile: infra/Dockerfile.fabric
    ports:
      - "4311:4311"
    environment:
      FABRIC_PORT: "4311"
      OVERWATCH_DB: /data/overwatch.db
      OVERWATCH_KEY_PATH: /data/key.bin
    volumes:
      - overwatch_data:/data
    restart: unless-stopped

  web:
    build:
      context: ..
      dockerfile: infra/Dockerfile.web
    ports:
      - "3311:3311"
    environment:
      FABRIC_URL: http://fabric:4311
      NEXT_PUBLIC_FABRIC_WS: ws://localhost:4311
      NEXT_PUBLIC_GO2RTC_URL: http://localhost:1984
    depends_on:
      - fabric
    restart: unless-stopped

  go2rtc:
    image: alexxit/go2rtc:latest
    network_mode: host
    volumes:
      - ./go2rtc.yaml:/config/go2rtc.yaml:ro
    restart: unless-stopped

volumes:
  overwatch_data:
```

### `fabric` service

| Field | Value | Notes |
|---|---|---|
| Build context | `..` | The build runs from the repo root with `infra/Dockerfile.fabric`. |
| Listen port | `4311` (mapped to host `4311`) | `FABRIC_PORT=4311`. |
| `OVERWATCH_DB` | `/data/overwatch.db` | Inside the named `overwatch_data` volume. |
| `OVERWATCH_KEY_PATH` | `/data/key.bin` | The AES-256-GCM key, persisted across container restarts via the volume. Lose the volume, lose every encrypted connector config. |
| Restart policy | `unless-stopped` | Survives docker daemon restarts. |

### `web` service

| Field | Value | Notes |
|---|---|---|
| Listen port | `3311` (mapped to host `3311`) | Hard-coded in `apps/web/package.json:scripts.{dev,start}` (`next start -p 3311`). |
| `FABRIC_URL` | `http://fabric:4311` | Used by `next.config.mjs:rewrites()` so `/fabric/*` proxies to the sibling container. |
| `NEXT_PUBLIC_FABRIC_WS` | `ws://localhost:4311` | The browser, not the container, opens this connection. The hostname must be reachable from the user's machine — `localhost` here implies the developer accesses both containers via the host's port mappings. |
| `NEXT_PUBLIC_GO2RTC_URL` | `http://localhost:1984` | Same reasoning: WHEP requests originate in the browser. |
| Depends on | `fabric` | Compose start order only; not a healthcheck dependency. |

### `go2rtc` service

| Field | Value | Notes |
|---|---|---|
| Image | `alexxit/go2rtc:latest` | Pulled fresh; no version pin. |
| Network mode | `host` | Required so WebRTC ICE candidates (the `host:8555` line in `infra/go2rtc.yaml`) bind on a routable interface. On macOS Docker Desktop this still works as long as the host's `:8555` is reachable from the browser. |
| Volume | `./go2rtc.yaml:/config/go2rtc.yaml:ro` | Read-only mount of the streams config. |

`network_mode: host` on macOS is the standard workaround for go2rtc's WebRTC ICE candidate model. Without it, candidates point at the bridged container IP that the browser can't reach.

## Build stages — Dockerfile.fabric

`infra/Dockerfile.fabric` uses three stages: `deps`, `build`, `run`.

```Dockerfile
FROM node:22-bookworm-slim AS deps
RUN apt-get update && apt-get install -y python3 build-essential && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY apps/fabric/package.json apps/fabric/
COPY packages/connectors/package.json packages/connectors/
COPY packages/schemas/package.json packages/schemas/
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY . .

FROM node:22-bookworm-slim AS run
WORKDIR /app
COPY --from=build /app /app
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
ENV NODE_ENV=production
EXPOSE 4311
CMD ["pnpm", "--filter=@overwatch/fabric", "start"]
```

Notes:
- `python3 build-essential` is required for the `better-sqlite3` native build.
- `--frozen-lockfile=false` lets the install proceed if `pnpm-lock.yaml` is out of sync. This is convenient but means the resulting image isn't byte-stable.
- The fabric is **not transpiled to JavaScript**. The `start` script is `tsx src/index.ts`. The image carries the entire repo (`COPY --from=build /app /app`) and runs TypeScript directly.
- Three workspace `package.json` files (`apps/fabric`, `packages/connectors`, `packages/schemas`) are copied before the install layer to maximise layer-cache reuse.

## Build stages — Dockerfile.web

`infra/Dockerfile.web`:

```Dockerfile
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/schemas/package.json packages/schemas/
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY . .
RUN pnpm --filter=@overwatch/web build

FROM node:22-bookworm-slim AS run
WORKDIR /app
COPY --from=build /app /app
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
ENV NODE_ENV=production
EXPOSE 3311
CMD ["pnpm", "--filter=@overwatch/web", "start"]
```

Notes:
- The web image *is* built (`next build`) so the `run` stage executes the optimised production server.
- The deps layer copies only `apps/web/package.json` and `packages/schemas/package.json` since the web bundle does not import `@overwatch/connectors`.
- No `python3 build-essential` because `@huggingface/transformers` is downloaded by the browser at runtime, not bundled with native deps.

## go2rtc — RTSP/HLS → WHEP proxy

`infra/go2rtc.yaml`:

```yaml
api:
  listen: ":1984"
  origin: "*"
webrtc:
  candidates:
    - host:8555

streams:
  bigbuckbunny: ffmpeg:https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8
  road-cam: ffmpeg:https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4#video=copy#raw_query
```

What it does:
- Listens on `:1984` for the HTTP API (catalog, WHEP endpoint).
- Listens on `:8555` for WebRTC ICE candidates. The `candidates: [host:8555]` line tells go2rtc to advertise this address in SDP answers.
- Two demo streams are pre-defined. `bigbuckbunny` ingests an HLS manifest via `ffmpeg`; `road-cam` ingests an MP4 with copy of the video stream.
- `origin: "*"` lets the browser call the API cross-origin without a CORS prompt.

The browser does WHEP playback as follows (see `apps/web/src/components/CameraTile.tsx:playWhep()`):

```ts
// SDP offer/answer round-trip
const pc = new RTCPeerConnection({ ... });
const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
await pc.setLocalDescription(offer);
const r = await fetch(camera.whepUrl, {
  method: "POST",
  headers: { "Content-Type": "application/sdp" },
  body: offer.sdp,
});
const sdp = await r.text();
await pc.setRemoteDescription({ type: "answer", sdp });
```

To add a stream, edit `infra/go2rtc.yaml` and `docker compose restart go2rtc`. The seeded demo cameras in `scripts/seed-demo.ts` reference `bigbuckbunny` by name; the `whepUrl` is computed at the React layer from `NEXT_PUBLIC_GO2RTC_URL` plus the stream name (`{base}/api/whep?src={name}`).

## Bring-up sequence

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build

# Wait for fabric to log "fabric listening on 4311", then in another shell:
pnpm seed
```

`pnpm seed` runs `tsx scripts/seed-demo.ts` which posts to `/api/connectors`, `/api/cameras`, `/api/locations`. It expects fabric to be reachable at `FABRIC_URL` (default `http://localhost:4311`) — see [overview/getting-started § first-run checklist](../overview/getting-started.md#first-run-checklist).

`pnpm seed` is idempotent for connector instances (it `INSERT OR REPLACE`s by `id`) but the seed script's defaults will overwrite any custom config you have for the same demo IDs.

## Useful production URLs (once it's running)

| URL | Purpose |
|---|---|
| `http://localhost:3311` | Main dashboard. |
| `http://localhost:3311/connectors` | Connector CRUD. |
| `http://localhost:3311/rules` | Alert rules CRUD. |
| `http://localhost:4311/health` | `{ ok: true, time: ISO }`. |
| `http://localhost:4311/api/connectors/catalog` | Full catalog with `defaults` and `configFields[]`. |
| `http://localhost:4311/api/events?limit=200` | Last 200 ingested events. |
| `http://localhost:4311/api/threatcon` | Current THREATCON + PIRs. |
| `http://localhost:4311/api/firings?limit=50` | Recent rule firings. |
| `http://localhost:1984` | go2rtc admin UI (when running). |
| `ws://localhost:4311/ws` | The WebSocket endpoint. Use `websocat` to inspect (see [debugging](../how-to-contribute/debugging.md#debug-websocket-envelopes)). |

## Production hardening

The repo is shipped as a personal-scale console; none of these are done out of the box. If you want to expose Overwatch beyond `localhost`, you'll need to add them yourself.

- **HTTPS reverse proxy.** Run an nginx/Caddy/traefik container in front of `web` and `fabric` so traffic is encrypted. The browser also requires HTTPS for `getUserMedia` (webcam tiles) and a secure WebSocket (`wss://`) once the page is on HTTPS.
- **Authentication.** There is no login screen, no API key, no JWT. Anything that can reach `:4311` can `POST /api/connectors`, `DELETE /api/rules/:id`, and read every event. Wrap the Fastify app with `@fastify/auth` + `@fastify/basic-auth`, or front-door with an OIDC reverse proxy.
- **Tighten CORS.** `apps/fabric/src/index.ts` registers `cors` with `{ origin: true }`. Behind a reverse proxy, restrict `origin` to your dashboard hostname.
- **Rate-limit the public surface.** `/ingest/:key` accepts arbitrary JSON, `/api/cv-event` accepts arbitrary titles/payloads, `/api/connectors` accepts arbitrary configs. Add `@fastify/rate-limit` and tune per-route.
- **Database backups.** SQLite is one file per database; back up `OVERWATCH_DB` *and* `OVERWATCH_KEY_PATH` together — losing the key destroys every encrypted connector config. The simplest scheme is `cp` while running (WAL mode is safe to copy live, though you should also copy `*.wal` and `*.shm` siblings) or `sqlite3 source ".backup target"` for a consistent snapshot.
- **DB compaction.** The `events` table grows without bound. Add a periodic `DELETE FROM events WHERE received_at < datetime('now','-30 days')` plus `VACUUM` to keep the database small.
- **Log rotation.** Fastify writes pino logs to stdout; in Docker that means `journalctl` / Docker's JSON file driver, both of which need rotation configured at the daemon level.
- **TLS for outbound connectors.** Default fetches use plain HTTPS, which is fine. The MQTT connector defaults to `wss://broker.hivemq.com:8884/mqtt` — verify the URL hasn't been downgraded to plaintext if you customise.
- **Restrict `network_mode: host`.** On Linux, `go2rtc` running with host networking sees every interface. If you don't need RTSP, drop the service entirely; if you do, restrict the bind ranges in `infra/go2rtc.yaml`.
- **Pin go2rtc version.** Replace `alexxit/go2rtc:latest` with a specific tag (`alexxit/go2rtc:1.9.4` or whatever you've validated).
- **Set `NODE_ENV=production`.** Already set in both Dockerfiles. If you run `pnpm --filter @overwatch/fabric start` outside Docker, set it manually.
- **Health checks.** `docker-compose.yml` lacks `healthcheck:` blocks. Add `test: ["CMD", "curl", "-f", "http://localhost:4311/health"]` to `fabric` and Next.js's `/_next/health` equivalent for `web`.

## See also

- [reference/configuration](./configuration.md) — env vars table.
- [reference/security](./security.md) — full threat model.
- [overview/getting-started](../overview/getting-started.md) — local dev workflow.
