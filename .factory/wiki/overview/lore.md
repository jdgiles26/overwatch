# Lore

A short page on what is and isn't knowable about how Overwatch came to be. The repo has exactly one commit (`bc1d1ee`, "Initial commit", 2026-04-30, JDG-Tyto), so there is no history to mine. What follows is grounded in the README and in design decisions visible in the code.

## What the README says

`README.md` opens with:

> Real-time situational-awareness platform with a data-fabric ingestion fabric, RTSP/OpenCV camera feeds, a 3D globe map, and on-device WebGPU AI (analyst chat + autonomous Overseer agent that can drive the app).
>
> Inspired by `overglass.io` — extended with: pluggable connectors, generic IoT/MQTT/Webhook/RSS ingest, 3D globe (Cesium) + 2D MapLibre, browser-side computer-vision detection, and an autonomous browser agent powered by `@huggingface/transformers` on WebGPU.

So the stated lineage is `overglass.io/demo` (the public demo at <https://app.overglass.io/demo>). The Overwatch dashboard reproduces overglass's three-panel layout — IntelFeed | MapView | AssessmentPanel with a CameraStrip across the bottom — and adds:

- 22 connectors instead of overglass's curated set.
- Both Cesium 3D and MapLibre 2D, with a side-by-side split mode.
- A WebGPU LLM analyst, a WebGPU vision-captioning agent, and Whisper voice STT.
- Per-camera computer-vision in a Web Worker.
- A complete alert-rules engine with desktop notifications and audio.
- A DVR / time scrubber, a command palette, aircraft trails, and a PWA shell.

## A "from scratch in a single sitting" build

The single commit, no test files, no `.github/` actions, no `CHANGELOG.md`, and the unanimously-current dependency versions (Next.js 15, React 19, Fastify 5, Cesium 1.125) all point to this being a fresh build rather than an incremental evolution. Every file was written with the same conventions, by the same person, before the repo was first committed. There is no "v0 → v1" story; there is only the state at `bc1d1ee`.

This is not a bad thing. A single-sitting build can be internally consistent in ways an incrementally-grown codebase usually isn't. The trade-off is that there is no archaeological evidence of *why* a particular shape was chosen — any explanation is reverse-engineered from the code.

## Vestigial workspaces

`packages/agent/`, `packages/ai/`, `packages/cv/`, `packages/ui/` each contain:
- An empty `src/` directory.
- A `package.json` and a `tsconfig.json` declaring the workspace.
- Nothing else.

`pnpm-workspace.yaml` lists them but no other package depends on them and no source file is exported from any of them. The naming pattern matches the four "thick" sub-systems of the dashboard:

- `packages/agent` for Overseer planning logic.
- `packages/ai` for Transformers.js wiring.
- `packages/cv` for the camera Web Worker.
- `packages/ui` for shared design-system primitives.

The actual code for all four lives inline in `apps/web/src/lib/` (`agent.ts`, `ai.ts`, `voice.ts`) and `apps/web/src/components/` (`cvWorker.ts`, the panel components, the `.panel`/`.btn` Tailwind utilities in `globals.css`). The placeholders look like an early plan to split the web app into reusable libraries that was abandoned in favour of keeping everything inline. Two reasonable readings:

- **YAGNI won.** The split would have added boilerplate without saving any code today. Inlining keeps the import graph short and the build fast.
- **The author intended to extract later.** The directories and `package.json`s are still in place, ready to be filled in once a second consumer needs them.

Either way, the names act as architectural signposts even when the directories are empty: a maintainer reading the workspace list sees that the inline code is conceptually separable.

## Design decisions visible in the code

The following choices are not explained in the README but are visible in the source. Each is offered with the most plausible motivation; treat them as informed conjecture.

### No tests

`rg --type ts -l 'describe\(|it\(|test\('` returns nothing across the repo. There is no Vitest, Jest, or Playwright config. The most charitable reading is that the project's surface (live data feeds, browser GPU, RTSP streams, on-device LLMs) is hostile to unit tests — most of the *interesting* behaviour is integration with external systems that no test rig can faithfully simulate. A less charitable reading is that the single-sitting build prioritised the demo over verification. Either way, the code is structured to be testable: the schemas are pure Zod, `RuleEngine.evaluate` and `computeThreatcon` / `computePIR` are pure functions, the connectors are interface-driven. A maintainer who wants to add tests has clean seams.

### SQLite over Postgres

`apps/fabric/src/db.ts` uses `better-sqlite3` with WAL mode. Tradeoffs:

- **Synchronous API.** Every DB call blocks the Node event loop briefly. With one user and a few thousand events per hour, this is invisible. With dozens of clients it would matter.
- **Single-file deployment.** The committed `apps/fabric/data/overwatch.db` is enough state to demo the app on a fresh clone.
- **No migrations.** All seven tables are declared with `IF NOT EXISTS` in one `db.exec(...)` call. Schema evolution would require explicit migration code that doesn't exist yet.

For a single-user console, SQLite + WAL is the smallest piece of state that works. Postgres would have meant a Docker dependency for local dev with no behavioural payoff.

### Cesium AND MapLibre

Most projects pick one. Overwatch ships both:

- `Map3D.tsx` for a Cesium globe (rich 3D, heavy first load).
- `Map2D.tsx` for a MapLibre flat map with a heatmap layer (light, GPU-accelerated, but no globe).

The split-view (`view: "split"`) renders both side-by-side. A user with one map library would have to choose between "globe" and "heatmap"; rendering both means each can be optimised for its strength. The cost is double the bundle (mitigated by `next/dynamic` lazy loading) and double the surface area for bugs.

### WebGPU LLM rather than calling an API

`apps/web/src/lib/ai.ts` runs every model in the browser. No API key, no network round-trip per chat turn, no privacy boundary to worry about. Trade-offs:

- **First-load weight.** SmolLM2-360M is roughly 200 MB after quantisation; Llama-3.2-1B is ~700 MB.
- **WebGPU coverage.** Chrome / Edge desktop only by default. Safari falls back to WASM (slower).
- **No frontier models.** SmolLM2-360M is significantly weaker than even gpt-3.5-turbo. The briefing prompt is engineered around the 360M's strengths (short, structured outputs).

The choice signals "this is a personal console; your data should stay on your machine."

### Webhook router uses a globalThis singleton

`packages/connectors/src/sources/webhook.ts`:

```ts
declare global {
  var __overwatchWebhookRouter: Map<string, (body: any) => void> | undefined;
}
export function getWebhookRouter() {
  if (!globalThis.__overwatchWebhookRouter) globalThis.__overwatchWebhookRouter = new Map();
  return globalThis.__overwatchWebhookRouter;
}
```

This is a deliberate cross-bundle global. The Fastify route `POST /ingest/:key` (in `apps/fabric/src/index.ts`) needs to find the right connector instance to forward the body to. The connectors live in the `@overwatch/connectors` package, which is bundled separately. Module-scope state inside that package would not be visible from the fabric's route handler — they're in different `import` graphs. Hanging it off `globalThis` resolves the visibility problem with one line of "ugly" code instead of a more elaborate dependency-injection scheme. See [overview/fun-facts](./fun-facts.md).

### `data/` committed to git

`apps/fabric/data/overwatch.db` (≈2 MB) and `apps/fabric/data/key.bin` (32 bytes) are both committed in the initial commit. This is unusual for a real product (encrypted secrets in git is normally a no-no), but it's deliberate here: it makes a `git clone && pnpm install && pnpm dev` first-run produce a populated demo without the user having to seed anything. The `key.bin` file decrypts the connector configs in `connector_instances.config`, which is needed for the seeded connectors to start.

For a public deployment, both files should be deleted (or `.gitignore`d) and regenerated on first boot.

### `forge`-style icon over a real PNG bundle

`apps/web/public/icon.svg` is a 64×64 SVG with a radial gradient. The manifest references it with `sizes: "any"`. A "production" PWA would ship a 192×192 and a 512×512 PNG; the SVG-only choice keeps `apps/web/public/` tiny at the cost of slightly worse iOS home-screen icons. See [features/pwa](../features/pwa.md).

### The four panel sizes are hard-coded

The IntelFeed is `w-80` (320 px). The AssessmentPanel is `w-80` (320 px). The AnalystPanel and OverseerPanel are both `w-[420px]`. The CameraStrip is 128 px tall. None of these are configurable. A user with a 4K monitor and 100% scaling has the same panel widths as a user on a 13" laptop. The single-sitting build prioritised "looks good on the author's monitor" over responsive layout.

## Honest uncertainty

Things that are not knowable from this commit:

- **Whether the four placeholder workspaces will ever be filled in.** They could be future-proofing or abandoned scaffolding.
- **Whether the empty `data/` files in `apps/fabric/` are meant to ship.** Most ports of this repo to a real deployment would delete them.
- **Whether the seed script is the canonical demo or a one-off.** It's referenced from the README's quickstart, so it's at least *a* demo path; whether it's *the* demo path is a judgement call.
- **Whether 12,112 lines is the intended size.** It could be a complete first cut, or it could be the floor of a planned expansion. The empty workspaces argue for the latter.

## Related pages

- [overview/index](./index.md) — the narrative landing page.
- [overview/by-the-numbers](./by-the-numbers.md) — exact counts.
- [overview/fun-facts](./fun-facts.md) — quirks a maintainer would notice.
- [overview/architecture](./architecture.md) — the structural story.
