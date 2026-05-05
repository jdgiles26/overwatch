# How to contribute

Overwatch is a small, opinionated codebase: pnpm 10 monorepo, Next.js 15 + React 19 on the front, Fastify 5 + better-sqlite3 on the back, Zod-first schemas in the middle. Most "where does X live?" answers are within two grep hops.

## Sub-pages

- [Patterns and conventions](./patterns-and-conventions.md) — the rules the existing code follows. Read this before adding anything substantial.
- [Development workflow](./development-workflow.md) — install, run, seed, the typical Edit→typecheck→build cycle, and how to add a connector / panel / schema field.
- [Testing](./testing.md) — there are zero tests in the tree. Read this if you want to add the first.
- [Debugging](./debugging.md) — typecheck, dev overlay, SQLite inspection, WebSocket peek, common Map3D / WHEP / native-rebuild failures.

## The basic flow

```bash
git clone <repo>
cd overwatch
corepack enable && corepack prepare pnpm@10.33.2 --activate
pnpm install

# branch
git checkout -b feature/my-thing

# typecheck and build before anything else
pnpm typecheck
pnpm --filter @overwatch/web build

# develop
pnpm --filter @overwatch/fabric dev    # terminal 1
pnpm --filter @overwatch/web dev       # terminal 2
pnpm seed                              # one-time, after fabric is up

# verify before opening a PR
pnpm verify         # = pnpm typecheck && pnpm lint
```

Once everything looks right, push and open a PR. The repo currently has **one commit** (`bc1d1ee`, 2026-04-30) on `main` and **no CI**, so verification is on you.

## Branch naming

There is no enforced convention; the existing branch is `JDG-Tyto`. Pick something descriptive (`feature/...`, `fix/...`, `docs/...`).

## Commit messages

Reference symbols by their absolute path so grep keeps working — see [patterns-and-conventions § Files mention IDs everywhere](./patterns-and-conventions.md#files-mention-ids-everywhere). Example:

> `apps/fabric/src/orchestrator.ts: clamp eventsLastMinute to non-negative`

## What you must do before opening a PR

1. **`pnpm typecheck`** at the repo root. Every workspace must pass `tsc --noEmit`. The strict TypeScript settings in `tsconfig.base.json` (especially `noUncheckedIndexedAccess`) catch real bugs.
2. **`pnpm --filter @overwatch/web build`**. `next build` runs a stricter type pass than `tsc --noEmit` and bundles the client. A green typecheck does not imply a green build.
3. **Manually verify the change.** There are no tests yet (see [testing](./testing.md)). For UI changes, run the dev servers, seed, click around. For fabric changes, hit the relevant REST endpoint and watch the WebSocket. See [debugging § debug websocket envelopes](./debugging.md#debug-websocket-envelopes) for `websocat`.
4. **Lint where it exists.** `pnpm lint` only does anything in `@overwatch/web` (it's `next lint`). The fabric, schemas, and connectors workspaces have no lint script.
5. **Re-seed if you touched seed-relevant data.** `scripts/seed-demo.ts` writes default connector instances, three demo cameras, and three home locations. If you added or renamed a connector, update the seed script.

There is no `pnpm test` you can run — `pnpm -r run test` is wired in `/package.json` but no workspace defines a `test` script. See [testing](./testing.md) for the proposed minimal layer if you want to add the first one.

## What you don't need to do

- **No code formatter to run.** There is no Prettier config, no Husky hook, no `pnpm format`. Match the surrounding style: 2-space indent, double-quoted strings, trailing commas, `"use client"` at the top of every browser-side file.
- **No CHANGELOG to update.** There isn't one in the repo.
- **No README to update.** Unless your change is documentation-facing.
- **No API doc to regenerate.** Schemas in `packages/schemas/src/index.ts` are the contract; that's the doc.
- **No CI to wait on.** There isn't one (yet).

## Where to start, by intent

- **Add a new data source** → [packages/connectors](../packages/connectors.md) → [development-workflow § add a connector](./development-workflow.md#add-a-connector).
- **Add a new panel or component** → [apps/web](../apps/web.md) → [development-workflow § add a panel](./development-workflow.md#add-a-panel-or-component).
- **Add a field to an event / connector / camera / rule** → [packages/schemas](../packages/schemas.md) → [development-workflow § add a schema field](./development-workflow.md#add-a-schema-field).
- **Add a new alert rule condition** → `apps/fabric/src/alerts.ts → evaluate()` and `packages/schemas/src/index.ts → AlertRuleCondition`.
- **Tweak THREATCON / PIR scoring** → `apps/fabric/src/threatcon.ts`. Pure functions, no DB access.
- **Add a Cmd-K command** → `apps/web/src/components/CommandPalette.tsx`.
- **Add an Overseer action** → `apps/web/src/lib/agent.ts → executeAction()` plus the `SYSTEM` prompt.
- **Wire a new env var** → [reference/configuration](../reference/configuration.md) and update `/.env.example`.

## Things to keep in mind

- **Schemas first.** Anything that crosses a process boundary (REST body, WebSocket envelope, persisted SQLite row) must be a Zod schema in `packages/schemas/src/index.ts`. See [patterns-and-conventions § schemas-first](./patterns-and-conventions.md#schemas-first).
- **One source of truth for state on the web.** Zustand. There is no React Query / SWR / context provider. `useStore((s) => s.events)` is the pattern.
- **Trust the in-process producers.** The web app does `JSON.parse` + `switch (msg.type)` rather than `ServerToClient.parse(msg)` for WebSocket payloads. Don't add per-event Zod parsing on hot paths without a reason.
- **Lazy-import heavy code.** `@huggingface/transformers`, `cesium`, `maplibre-gl` are dynamic-imported. See [patterns-and-conventions § dynamic imports for heavy code](./patterns-and-conventions.md#dynamic-imports-for-heavy-code).
- **Tag interactive elements with `data-agent="..."`.** That's the Overseer's allowlist. Without the attribute, the agent cannot click the element. Searchable: `rg 'data-agent='`.

## See also

- [overview/getting-started](../overview/getting-started.md) — first-run checklist with environment variables and common failures.
- [overview/architecture](../overview/architecture.md) — the 30-second mental model.
- [packages/schemas](../packages/schemas.md) — the contract layer.
- [packages/connectors](../packages/connectors.md) — adding a new data source.
- [apps/web](../apps/web.md) — frontend tour.
- [apps/fabric](../apps/fabric.md) — backend tour.
