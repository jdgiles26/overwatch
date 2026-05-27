# 01 — Docker deployment · TDD checklist

Each item is one assertion. Mark `[x]` when green.

- [x] `docker-compose.yml` does not contain `network_mode: host`.
- [x] `docker-compose.yml` publishes `1984:1984`, `8555:8555/tcp`, `8555:8555/udp`.
- [x] `Dockerfile.web` declares `ARG NEXT_PUBLIC_FABRIC_URL` in the build stage.
- [x] `Dockerfile.web` declares `ARG NEXT_PUBLIC_FABRIC_WS` in the build stage.
- [x] `Dockerfile.web` declares `ARG NEXT_PUBLIC_GO2RTC_URL` in the build stage.
- [x] `docker-compose.yml` passes all three `NEXT_PUBLIC_*` keys as build args.
- [x] `docker-compose.yml` defines a healthcheck on `fabric` hitting `/health`.
- [x] `web` service `depends_on.fabric.condition` is `service_healthy`.
- [x] `apps/fabric/src/index.ts` still registers `GET /health`.
- [ ] **MANUAL**: `docker compose up --build` on macOS Docker Desktop;
      browser at `http://localhost:3311` connects to the fabric WS
      without errors.
- [ ] **MANUAL**: same on Linux native Docker.
- [ ] Root `README.md` Docker quickstart calls out the
      build-arg override path.
- [ ] `infra/README.md` no longer claims that host networking is
      silently ignored — it has been removed.

The first nine items are auto-checked by `scripts/drift-check.ts` and
by `tests/compose.contract.test.ts`. The manual items are the
acceptance gate.
