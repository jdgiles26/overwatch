# Patterns and conventions

Conventions extracted from the codebase. These are descriptive — they're what the code does, not aspirational style guidelines.

## Schemas-first

Every wire object lives in `packages/schemas/src/index.ts` as a Zod schema, and *every* TypeScript type is a `z.infer<typeof X>`. The fabric and the web app share one source of truth via the workspace alias `@overwatch/schemas`.

```ts
// packages/schemas/src/index.ts
export const IngestEvent = z.object({
  id: z.string(),
  category: EventCategory,
  severity: Severity.default("info"),
  // …
});
export type IngestEvent = z.infer<typeof IngestEvent>;
```

Three rules:
1. If it crosses a process boundary, it's a Zod schema in `packages/schemas/src/index.ts`.
2. If it's persisted to SQLite, the column shape comes from the schema (see `apps/fabric/src/db.ts → rowToEvent()`).
3. The WebSocket envelope is a `z.discriminatedUnion("type", […])`. New message types must be added there before the producer or consumer can handle them.

## The connector contract

Every connector under `packages/connectors/src/sources/*.ts` exports an instance of `Connector<TCfg>`, defined in `packages/connectors/src/types.ts`:

```ts
export const myConnector = defineConnector<z.infer<typeof Cfg>>({
  id: "my-source",
  label: "My Source",
  description: "…",
  category: "iot",
  authKind: "none",       // none | api-key | oauth | mqtt | webhook | rtsp
  freeTier: true,
  configSchema: Cfg,      // a Zod schema
  defaultConfig: { … },
  pollIntervalMs: 60_000,
  async run(ctx) {
    while (!ctx.signal.aborted) {
      try {
        // fetch / subscribe / poll
        ctx.emit({ id, category, severity, title, occurredAt: ctx.now(), … });
      } catch (e: any) {
        if (ctx.signal.aborted) return;
        ctx.log(`error: ${e.message}`);
      }
      await sleep(ctx.pollIntervalMs ?? 60_000, ctx.signal);
    }
  },
});
```

Hard rules:
- The function never returns until `ctx.signal` aborts. The orchestrator owns the lifecycle.
- Every iteration must respect `ctx.signal` — both via `fetch(url, { signal: ctx.signal })` and via the `sleep(ms, signal)` helper from `packages/connectors/src/util.ts`.
- The orchestrator stamps `connectorId`, `source`, and `receivedAt`, so callers should *not* set them.
- Errors that you can recover from go to `ctx.log()`. Throwing escapes the connector and surfaces the message to the UI as a status error (`apps/fabric/src/orchestrator.ts:runOne → catch`).
- Use `ctx.config.<field>` rather than reading globals; the config object has already been validated by `connector.configSchema.parse()`.

After writing the connector, register it in three places:
1. `import` and re-export at the top of `packages/connectors/src/index.ts`.
2. Append to the `ALL_CONNECTORS` array in the same file.
3. *(Optional)* add to `scripts/seed-demo.ts` for default seeding.

## Files mention IDs everywhere

Throughout the code, the convention is to refer to pieces by their absolute paths so that grep works:

> `apps/fabric/src/db.ts → recentEvents()`
> `apps/web/src/components/Map3D.tsx`

Use this style in commit messages and code comments. The wiki follows the same convention.

## React conventions

The web app is **client-first** — almost every component is `"use client"`. The only meaningful server work in Next.js is the rewrite to fabric in `apps/web/next.config.mjs`.

- **Zustand** is the *only* shared state primitive. Local component state uses `useState`; everything else goes through `apps/web/src/lib/store.ts`. Selectors are inline arrow functions: `useStore((s) => s.events)`.
- **No prop drilling.** If two components need the same data, they both read from the store.
- **No React Query / SWR.** The fabric is the single source of truth via WebSocket; HTTP calls (`apiGet`/`apiPost`/`apiDelete` in `apps/web/src/lib/api.ts`) are fire-and-forget for mutations. After a mutation, either the server pushes an updated `status`/`rules` envelope or the caller re-reads the list.
- **Tailwind classes** with the `cn()` helper from `apps/web/src/lib/cn.ts` (clsx + tailwind-merge). Custom design tokens live in `apps/web/tailwind.config.ts`: `accent-*`, `ink-*`, `threat-{nominal|guarded|elevated|high|critical}`.
- **Lucide React** for every icon. Don't ship SVGs by hand.
- **`data-agent="…"` attributes** on every interactive element the [Overseer](../features/overseer-agent.md) might want to click. Searchable: `rg 'data-agent='`.

## File-naming

| | |
|---|---|
| **Components** | `PascalCase.tsx` in `apps/web/src/components/`. |
| **Hooks/libs** | `camelCase.ts` in `apps/web/src/lib/`. |
| **Web Workers** | `*Worker.ts` in `apps/web/src/components/`, instantiated with `new Worker(new URL("./fooWorker.ts", import.meta.url), { type: "module" })`. |
| **Connector sources** | `kebab-case.ts` in `packages/connectors/src/sources/`. |
| **Routes** | Next.js App Router, kebab-case: `app/connectors/page.tsx`, `app/rules/page.tsx`. |

## TypeScript settings

`tsconfig.base.json` is shared by every workspace and turns on every strictness option except `exactOptionalPropertyTypes`:

- `strict: true`
- `noUncheckedIndexedAccess: true` — array access yields `T | undefined` so most array reads must use `?.` or `?? fallback`
- `target: "ES2022"`, `module: "ESNext"`, `moduleResolution: "Bundler"`
- `lib: ["ES2022", "DOM", "DOM.Iterable", "WebWorker"]` — workers are first-class.

Ramifications visible in code:
- `data[i]!` non-null assertions or `data[i] ?? 0` fallbacks (see `apps/web/src/lib/voice.ts → blobToFloat32`).
- The `apps/web/src/components/cvWorker.ts` heuristic functions all use `data[i]!` because their loops are bounded by the same length they walk.

## Imports

ESM-only (`"type": "module"` in every `package.json`). Workspace packages are imported by alias:

```ts
import type { IngestEvent } from "@overwatch/schemas";
import { ALL_CONNECTORS, getConnectorById } from "@overwatch/connectors";
```

Inside a workspace, relative imports must include the `.js` extension because of `moduleResolution: "Bundler"` + Node ESM:

```ts
// apps/fabric/src/index.ts
import { db } from "./db.js";
import { computePIR, computeThreatcon } from "./threatcon.js";
```

## Dynamic imports for heavy code

Two reasons to use `await import(…)`:

1. **Server-only / native modules** in client code. `@huggingface/transformers` and `onnxruntime-node` are listed in `serverExternalPackages` and stubbed via `webpack.fallback` in `apps/web/next.config.mjs`. Components like `AnalystPanel.tsx` and `voice.ts` `await import("./ai")` so the heavy WebGPU bundle is split out.
2. **Map renderers**. `MapView.tsx` uses `next/dynamic` with `ssr: false` for `Map2D.tsx` and `Map3D.tsx`. Cesium and MapLibre touch `window` synchronously at import time; SSR would crash.

## Crypto-at-rest

Connector configs frequently contain API keys. `apps/fabric/src/db.ts` lazily generates a 32-byte key on first run (`OVERWATCH_KEY_PATH`, default `./data/key.bin`, mode `0o600`) and uses AES-256-GCM with a 12-byte IV per write. The encrypted base64 lands in `connector_instances.config`.

If you need to store another secret at rest, use the same `encrypt(plain) -> base64` / `decrypt(base64) -> plain` helpers exported from that file.

## Logging

- Fabric: `app.log.info(…)` (Fastify's pino) for lifecycle messages. Connectors use `ctx.log(msg)` — those messages surface to the UI in the [`AssessmentPanel`](../apps/web.md#assessmentpanel-right-rail) Source Health card under "errors".
- Web: there is no logger. `console.log` is fine for development, but the production CSP/COEP setup means devtools is the *only* sink.

## Error handling

- **Connectors**: catch + `ctx.log` + sleep + retry. Never throw out of `run()` unless the abort signal is set. The buffered last-five errors per instance are visible in `apps/fabric/src/orchestrator.ts → status.errors`.
- **Fabric REST**: Fastify route handlers return `reply.status(400|404).send({ error: … })` for client errors and let exceptions become 500s.
- **Web**: most async operations swallow errors silently because the dashboard auto-refreshes from WebSocket pushes. Examples:
  ```ts
  try { hls?.destroy(); } catch { /* ignore */ }
  ```
  This is intentional — the UI is a *view* of fabric state and shouldn't surface its own transient failures.

## Testing

There aren't any. 0 `.test.*` or `.spec.*` files. The implicit test plan is:

1. `pnpm typecheck` (per workspace) must pass.
2. `pnpm --filter @overwatch/web build` must succeed (next.js will fail on type errors that `tsc --noEmit` ignores).
3. Run `pnpm seed` and click around.

If you add tests, the conventions to set are still open. See [how-to-contribute/testing](./testing.md).

## Security defensiveness

- API keys are encrypted at rest (above).
- The Overseer agent is **sandboxed**: it can only invoke `data-agent="…"` clicks, and a whitelist of action types in `apps/web/src/lib/agent.ts`. It cannot run arbitrary JS.
- COOP/COEP headers are set in `apps/web/next.config.mjs` so that `SharedArrayBuffer` works for transformers.js *without* opening cross-origin isolation holes.
- Webhook payloads (`POST /ingest/:key`) require a key that matches a configured webhook connector instance. If no connector has registered for that key, the route returns 404 instead of accepting the data.

## What's deliberately not abstracted

- **No wrapper around `fetch`.** Connectors call `fetch(url, { signal })` directly. There's a tiny `fetchJson` / `fetchText` in `packages/connectors/src/util.ts` but most sources don't bother.
- **No DI container, no `@inversify`, no service registry.** Imports happen at the top of files; the orchestrator is a singleton (`export const orchestrator = new Orchestrator()`).
- **No GraphQL.** Plain REST and WebSocket envelopes.
- **No ORM.** Every SQL statement is a literal `db.prepare("INSERT OR REPLACE …")`.
- **No middleware tower.** Fastify hooks are unused beyond `cors` and `websocket` plugins.

This is a small codebase by design. Most of the "where does X live?" answers are within two grep hops.
