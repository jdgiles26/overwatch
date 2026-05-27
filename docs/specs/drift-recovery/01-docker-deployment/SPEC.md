# 01 — Docker deployment

## Goal

`docker compose -f infra/docker-compose.yml up --build` produces a
working OverWatch stack on macOS, Linux, and Windows (Docker Desktop
or native), with the browser able to reach the WebSocket on first
load, without manual port wrangling.

## Non-goals

- Production deployment (ingress, TLS, secrets management — separate spec).
- Replacing `pnpm dev` for local iteration.
- A health UI for the stack.

## Scope

| File | Change |
|---|---|
| `infra/docker-compose.yml` | publish go2rtc ports explicitly; add fabric healthcheck; `web` gated on `service_healthy`; wire `NEXT_PUBLIC_*` as build args |
| `infra/Dockerfile.web` | declare `ARG NEXT_PUBLIC_*`; ENV-bind into the `build` stage so Next.js inlines them |
| `infra/Dockerfile.fabric` | revert the band-aid `ENTRYPOINT ["/bin/bash", "-c"]` to a direct exec `CMD` |
| `infra/README.md` | document build-arg override path; remove the "host mode is silently ignored" caveat |
| `README.md` | clarify that `apps/fabric/data/` paths apply to `pnpm dev`, not the Docker volume |

The first four are shipped in the same commit as this spec — see
`DRIFT.md §2.1`. Item 5 (root README local-vs-docker path
clarification) is still open.

## Public contract

A user with a fresh clone and Docker Desktop should be able to:

```bash
git clone <repo> && cd <repo>
docker compose -f infra/docker-compose.yml up --build
# wait for "web ready in N ms"
open http://localhost:3311
# browser console shows: connected to ws://localhost:4311
```

…with **no edits to any file** between `clone` and `open`.

## Done-when

- `pnpm drift` passes `compose-publishes-go2rtc-ports`,
  `web-next-public-build-args`, `compose-passes-next-public-build-args`,
  `compose-fabric-healthcheck`, and `fabric-health-endpoint-exists`.
- `tests/compose.contract.test.ts` passes (it parses the compose
  YAML and asserts the contracts above without spinning containers).
- A reviewer has run the stack on macOS Docker Desktop *and* on
  Linux native Docker, and seen the web app load.
- Root `README.md` Docker section documents the build-arg override.
- The `infra/README.md` `host networking is ignored on macOS` note
  has been removed.

## Open question for the next agent

Should we add a `make up` / `make down` wrapper that runs
`docker compose ... && pnpm seed`? Cleaner UX but adds a tool the
README has to document.
