# Development workflow

Concrete commands and the typical Edit→typecheck→build cycle for Overwatch contributors. Pairs with [patterns-and-conventions](./patterns-and-conventions.md), which covers the *style* of the code, and [debugging](./debugging.md), which covers what to do when something breaks.

## Prerequisites

- Node 22+ (the Dockerfiles use `node:22-bookworm-slim`).
- pnpm 10.33.2+ via Corepack: `corepack enable && corepack prepare pnpm@10.33.2 --activate`.
- A modern browser. Chrome/Edge are best — WebGPU isn't required but everything is faster with it.
- Optional: Docker, for `infra/docker-compose.yml`.

See [overview/getting-started](../overview/getting-started.md) for the full first-run checklist.

## Install

```bash
pnpm install
```

This installs all four workspaces (`apps/web`, `apps/fabric`, `packages/connectors`, `packages/schemas`). The four placeholder workspaces (`packages/agent`, `packages/ai`, `packages/cv`, `packages/ui`) are empty and have no dependencies.

`pnpm install` will also:

- Trigger the native build of `better-sqlite3` (used by `apps/fabric`). On macOS arm64 / Node 22 this needs Xcode CLT (`xcode-select --install`); on Linux it needs `python3 build-essential` (the fabric Dockerfile installs these explicitly).
- Pre-fetch every Hugging Face model? **No.** Models are fetched lazily by the browser at runtime when a panel that needs them is opened.

## Monorepo layout

```
overwatch/
├── apps/
│   ├── fabric/                @overwatch/fabric — Fastify backend
│   └── web/                   @overwatch/web    — Next.js dashboard
├── packages/
│   ├── schemas/               @overwatch/schemas    — Zod source of truth
│   ├── connectors/            @overwatch/connectors — 22 data sources
│   ├── agent/  ai/  cv/  ui/  empty placeholder workspaces
├── infra/                     docker-compose, Dockerfiles, go2rtc.yaml
├── scripts/
│   └── seed-demo.ts           pnpm seed entry
├── package.json               root scripts (dev, build, typecheck, seed, verify)
├── pnpm-workspace.yaml        workspaces
└── tsconfig.base.json         shared TS config + workspace path mapping
```

Workspace package aliases (defined in `tsconfig.base.json` and resolved through pnpm hoisting):

```ts
import type { IngestEvent } from "@overwatch/schemas";
import { ALL_CONNECTORS, getConnectorById } from "@overwatch/connectors";
```

There is no compile step for the leaf packages — `tsconfig.base.json` maps `@overwatch/schemas` directly to `packages/schemas/src/index.ts` and `@overwatch/connectors` to `packages/connectors/src/index.ts`. Consumers compile the source.

## Package scripts

`/package.json`:

```jsonc
{
  "scripts": {
    "dev":       "pnpm -r --parallel --filter=./apps/* run dev",
    "build":     "pnpm -r run build",
    "start":     "pnpm -r --parallel --filter=./apps/* run start",
    "lint":      "pnpm -r run lint",
    "typecheck": "pnpm -r run typecheck",
    "test":      "pnpm -r run test",
    "seed":      "tsx scripts/seed-demo.ts",
    "verify":    "pnpm typecheck && pnpm lint"
  }
}
```

Per-workspace:

| Workspace | dev | build | start | typecheck | lint |
|---|---|---|---|---|---|
| `@overwatch/web` | `next dev -p 3311` | `next build` | `next start -p 3311` | `tsc --noEmit` | `next lint` |
| `@overwatch/fabric` | `tsx watch src/index.ts` | (none) | `tsx src/index.ts` | `tsc --noEmit` | (none) |
| `@overwatch/connectors` | (none) | (none) | (none) | `tsc --noEmit` | (none) |
| `@overwatch/schemas` | (none) | (none) | (none) | `tsc --noEmit` | (none) |

`pnpm test` is wired but no workspace defines a `test` script. See [testing](./testing.md).

## Run fabric and web concurrently

Two terminals:

```bash
# terminal 1
pnpm --filter @overwatch/fabric dev

# terminal 2
pnpm --filter @overwatch/web dev
```

Or one command via the root `dev` script (parallel pnpm filter):

```bash
pnpm dev
```

Logs are interleaved when you use `pnpm dev`; if you need clean output, use the per-filter form in two terminals.

Once fabric is up, seed:

```bash
pnpm seed
```

That posts to `/api/connectors`, `/api/cameras`, `/api/locations` to insert demo data. The script is idempotent (`INSERT OR REPLACE` on connector instance IDs).

## Typecheck and build

```bash
pnpm typecheck                              # all workspaces
pnpm --filter @overwatch/fabric typecheck   # one workspace
pnpm --filter @overwatch/web build          # production build
```

`pnpm verify` chains `typecheck` and `lint`:

```bash
pnpm verify
```

The strict TypeScript settings (`strict: true`, `noUncheckedIndexedAccess: true` in `tsconfig.base.json`) catch most real bugs at the typecheck stage. `next build` does an additional pass that occasionally surfaces issues `tsc --noEmit` lets through.

## The typical Edit→typecheck→build cycle

1. **Edit.** Pick the right place — see [where to start, by intent](./index.md#where-to-start-by-intent).
2. **Save.** If you're running `pnpm dev`, the fabric (via `tsx watch`) and Next.js HMR will auto-reload.
3. **Typecheck.** Run `pnpm typecheck` once you reach a checkpoint. The strict settings ensure most regressions show up here.
4. **Manual verify.** Open `http://localhost:3311`, click around, hit `http://localhost:4311/health`, watch the dev console.
5. **Build.** Before opening a PR, `pnpm --filter @overwatch/web build`. The production build catches a few classes of issue that dev doesn't.

## Add a connector

Detailed walkthrough: [packages/connectors § adding a new connector](../packages/connectors.md#adding-a-new-connector).

Quick recipe:

1. Create `packages/connectors/src/sources/your-source.ts`. Define a Zod `Cfg`, call `defineConnector({...})`, export it.
2. In `packages/connectors/src/index.ts`:
   - `import { yourSource } from "./sources/your-source.js";`
   - Re-export it.
   - Append it to `ALL_CONNECTORS`.
3. (Optional) Add a default instance in `scripts/seed-demo.ts` so `pnpm seed` picks it up.
4. `pnpm typecheck` from the repo root.
5. Restart fabric. `GET /api/connectors/catalog` will include the new connector. The `/connectors` page renders a form derived from the Zod schema; no UI work is needed for primitive shapes.

The connector contract is defined in `packages/connectors/src/types.ts`. Hard rules in [patterns-and-conventions § the connector contract](./patterns-and-conventions.md#the-connector-contract).

```ts
export const yourSource = defineConnector<z.infer<typeof Cfg>>({
  id: "your-source",
  label: "Your Source",
  description: "...",
  category: "iot",
  authKind: "none",
  freeTier: true,
  configSchema: Cfg,
  defaultConfig: { ... },
  pollIntervalMs: 60_000,
  async run(ctx) {
    while (!ctx.signal.aborted) {
      try {
        // fetch / subscribe
        ctx.emit({ id, category, severity, title, occurredAt: ctx.now(), ... });
      } catch (e: any) {
        if (ctx.signal.aborted) return;
        ctx.log(`error: ${e.message}`);
      }
      await sleep(ctx.pollIntervalMs ?? 60_000, ctx.signal);
    }
  },
});
```

## Add a panel or component

`apps/web/src/components/` is where every panel lives. The conventions:

- File name: `PascalCase.tsx`.
- Start with `"use client"` (almost everything in `apps/web/src/components/` does).
- Read shared state via `useStore((s) => s.foo)` from `apps/web/src/lib/store.ts`. Avoid prop drilling.
- Use Lucide icons (`lucide-react`) and Tailwind via the `cn()` helper from `apps/web/src/lib/cn.ts`.
- Tag interactive elements with `data-agent="..."` so the [Overseer](../features/overseer-agent.md) can click them.
- Use the `panel`, `btn`, `input`, `scrollable`, and `badge` utility classes from `apps/web/src/app/globals.css` instead of inline Tailwind soup.

Mounting a new panel:

1. Create `apps/web/src/components/YourPanel.tsx`.
2. Import and render it in `apps/web/src/app/page.tsx`. The map area is `position: relative` so absolute-positioned overlays slot in cleanly.
3. If the panel toggles, add a Zustand store key (`yourPanelOpen` + `setYourPanelOpen` action) and a `TopBar.tsx` button.
4. (Optional) Add a Cmd-K command in `apps/web/src/components/CommandPalette.tsx` to toggle it.

For data fetching:

- One-shot reads → `apiGet("/api/whatever")` from `apps/web/src/lib/api.ts`.
- Live data → already pushed by the WebSocket. Read from the store.
- Mutations → `apiPost`/`apiPatch`/`apiDelete`. The fabric will push an updated `status`/`rules` envelope; you don't need to refetch.

## Add a schema field

Detailed walkthrough: [packages/schemas § adding a schema field](../packages/schemas.md#adding-a-schema-field).

Two scenarios:

### Adding to a free-form blob

Adding `payload.duress?: boolean` is a no-op — `payload` is `z.record(z.any())` and accepts anything. Connectors just include it; consumers read `ev.payload?.duress`.

### Adding a top-level field to a schema

Example: adding `IngestEvent.tags?: string[]`.

1. Edit `packages/schemas/src/index.ts`:

```ts
export const IngestEvent = z.object({
  // ...
  tags: z.array(z.string()).optional(),
});
```

2. `pnpm typecheck` — the type flows automatically into both `apps/web` and `apps/fabric`.
3. If you want it persisted to SQLite, add a column in `apps/fabric/src/db.ts`:

```sql
ALTER TABLE events ADD COLUMN tags TEXT;
```

(There is no migration tool; you'd have to drop the DB or run `ALTER TABLE` by hand against `apps/fabric/data/overwatch.db` via `sqlite3`.)

Then update `persistEvent()` and `rowToEvent()` in `apps/fabric/src/db.ts` to JSON-encode/decode `tags`.

The field will travel through the WebSocket regardless of whether it's persisted.

### Adding a new WebSocket envelope type

1. Append a new arm to the `ServerToClient` discriminated union in `packages/schemas/src/index.ts`.
2. Add a producer in `apps/fabric/src/index.ts` (`broadcast({type: "newType", data: ...})`).
3. Add a handler in `apps/web/src/lib/ws.ts → ws.onmessage`.

Both ends must compile against the new schema before either side can produce or consume it.

## Useful one-liners

```bash
# Find every place that emits a schema field
rg '"icao24"' packages/connectors/src/sources/

# Find every Overseer-clickable element
rg 'data-agent='

# Show the Zod schemas in the contract layer
rg '^export const ' packages/schemas/src/index.ts

# Hit the catalog (fabric must be running)
curl -s http://localhost:4311/api/connectors/catalog | jq '.[] | {id, label, category}'

# Tail SQLite
sqlite3 apps/fabric/data/overwatch.db 'SELECT id, category, severity, title FROM events ORDER BY received_at DESC LIMIT 10;'
```

## See also

- [patterns-and-conventions](./patterns-and-conventions.md) — the descriptive style guide.
- [testing](./testing.md) — there are zero tests; recommendations for adding the first.
- [debugging](./debugging.md) — what to do when something breaks.
- [overview/getting-started](../overview/getting-started.md) — first-run checklist.
- [packages/connectors](../packages/connectors.md) — connector authoring reference.
- [packages/schemas](../packages/schemas.md) — contract layer.
