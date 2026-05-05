# Dependencies reference

What Overwatch ships, why, and where each dependency is wired in. Versions are pinned in the workspace `package.json` files:

- `/package.json` (root)
- `/apps/web/package.json`
- `/apps/fabric/package.json`
- `/packages/schemas/package.json`
- `/packages/connectors/package.json`

The four placeholder workspaces — `packages/agent/`, `packages/ai/`, `packages/cv/`, `packages/ui/` — declare nothing; their code lives inline in `apps/web/`. See [overview/index § Repository map](../overview/index.md#repository-map).

## Frontend framework

| Package | Version | Role | Files |
|---|---|---|---|
| `next` | `15.1.3` | App Router, the rewrite to fabric, the COOP/COEP headers, the dev server. | `apps/web/next.config.mjs`, `apps/web/src/app/**/*.tsx` |
| `react` | `19.0.0` | Render layer. | every `apps/web/src/components/*.tsx` |
| `react-dom` | `19.0.0` | DOM renderer. | implicit via `next` |
| `zustand` | `^5.0.2` | The only shared state primitive. Selectors are inline arrow functions like `useStore((s) => s.events)`. | `apps/web/src/lib/store.ts` |
| `lucide-react` | `^0.468.0` | Every icon. No hand-rolled SVGs. | every component touching iconography (`apps/web/src/components/IntelFeed.tsx → EventIcon`, `TopBar.tsx`, …) |
| `clsx` | `^2.1.1` | className concatenation. | `apps/web/src/lib/cn.ts` |
| `tailwind-merge` | `^2.6.0` | Resolves conflicting Tailwind utilities. | `apps/web/src/lib/cn.ts` |
| `tailwindcss` | `^3.4.17` | Design system. Custom tokens in `tailwind.config.ts`. | `apps/web/tailwind.config.ts`, `apps/web/src/app/globals.css` |
| `postcss`, `autoprefixer` | `^8.5.0`, `^10.4.20` | Tailwind pipeline. | `apps/web/postcss.config.*` |

## 3D + map

| Package | Version | Role | Files |
|---|---|---|---|
| `cesium` | `^1.125.0` | 3D globe, entity layer, fly-to camera, polyline aircraft trails. Workers and assets are loaded from the official Cesium CDN at runtime via `CESIUM_BASE_URL`. | `apps/web/src/components/Map3D.tsx` |
| `maplibre-gl` | `^4.7.1` | 2D OSM raster basemap, heatmap, circle layer, location rings. | `apps/web/src/components/Map2D.tsx` |
| `html-to-image` | `^1.11.13` | Fallback screenshot path for the [Overseer](../features/overseer-agent.md) agent's vision loop. The primary path reads visible WebGL canvases via `canvas.toBlob()`. | `apps/web/src/lib/agent.ts:captureScreenshot()` |

Both Cesium and MapLibre use `preserveDrawingBuffer: true` so `canvas.toBlob()` can read pixels — required for Overseer screenshots. See `apps/web/src/components/Map3D.tsx` (`contextOptions: { webgl: { preserveDrawingBuffer: true, alpha: true } }`) and `apps/web/src/components/Map2D.tsx`.

## AI

| Package | Version | Role | Files |
|---|---|---|---|
| `@huggingface/transformers` | `^3.0.2` | The Analyst LLM (`text-generation`), the topic worker (`zero-shot-classification`), the vision captioner (`image-to-text`), Whisper STT (`automatic-speech-recognition`). WebGPU first, WASM fallback. | `apps/web/src/lib/ai.ts`, `apps/web/src/lib/voice.ts`, `apps/web/src/components/topicWorker.ts` |

`@huggingface/transformers` and `onnxruntime-node` are listed in `serverExternalPackages` in `apps/web/next.config.mjs` and stubbed via `webpack.fallback` (`onnxruntime-node: false, sharp: false, fs: false, path: false, crypto: false`) so the browser bundle never tries to import the Node-only side. `apps/web/src/lib/ai.ts` lazy-imports the module:

```ts
async function getTransformers() {
  if (_transformers) return _transformers;
  installConsoleFilter();
  const mod = await import("@huggingface/transformers");
  // ...env tweaks for ORT log level...
  _transformers = mod;
  return mod;
}
```

## Streaming media

| Package | Version | Role | Files |
|---|---|---|---|
| `hls.js` | `^1.5.20` | HLS playback in browsers without native support. Loaded via dynamic `import("hls.js")` in the camera tile. Safari uses native HLS first. | `apps/web/src/components/CameraTile.tsx` |

WHEP/RTSP playback is *not* a library — it's a hand-rolled SDP offer/answer round-trip in `CameraTile.tsx:playWhep()` against the `go2rtc` sidecar. WebRTC and `RTCPeerConnection` come from the browser.

## Backend

| Package | Version | Role | Files |
|---|---|---|---|
| `fastify` | `^5.2.0` | HTTP server, route handlers, pino logger. | `apps/fabric/src/index.ts` |
| `@fastify/cors` | `^10.0.2` | `origin: true` (wide open during dev). | `apps/fabric/src/index.ts:app.register(cors, ...)` |
| `@fastify/websocket` | `^11.0.1` | The `/ws` route via `{ websocket: true }`. | `apps/fabric/src/index.ts` |
| `ws` | `^8.18.0` | Underlying WebSocket library used by `@fastify/websocket` and the MQTT connector. | implicit; `mqtt` connects over WS/WSS |
| `tsx` | `^4.20.1` | TypeScript runner; `tsx watch src/index.ts` for dev, `tsx src/index.ts` for prod. The fabric never gets compiled to JS — it executes `.ts` directly in Node. | `apps/fabric/package.json:scripts.{dev,start}` |

## DB

| Package | Version | Role | Files |
|---|---|---|---|
| `better-sqlite3` | `^11.7.0` | Synchronous SQLite. WAL mode, prepared statements, no ORM. | `apps/fabric/src/db.ts` |

`better-sqlite3` is a native module. The fabric Dockerfile installs `python3 build-essential` before `pnpm install` so the native build succeeds (`infra/Dockerfile.fabric`). On macOS arm64 Node 22, no extra steps are needed beyond Xcode CLT. See [how-to-contribute/debugging § better-sqlite3](../how-to-contribute/debugging.md#better-sqlite3-native-rebuild-errors).

## Connectors

| Package | Version | Role | Files |
|---|---|---|---|
| `mqtt` | `^5.10.3` | The IoT MQTT subscriber. Defaults to the HiveMQ public WS broker. | `packages/connectors/src/sources/mqtt-generic.ts` |
| `xml2js` | `^0.6.2` | RSS/Atom parser. | `packages/connectors/src/sources/rss.ts` |
| `zod` | `^3.24.1` | Every `configSchema` and the shared schemas in `packages/schemas`. | `packages/schemas/src/index.ts`, `packages/connectors/src/sources/*.ts` |

No other connector library: the rest is plain `fetch()` against public APIs.

## Tooling

| Package | Version | Role |
|---|---|---|
| `typescript` | `^5.9.2` | Strict mode, `noUncheckedIndexedAccess: true`, `target: ES2022`. See `tsconfig.base.json`. |
| `@types/node` | `^22.10.2` | Node 22 typings. |
| `@types/react`, `@types/react-dom` | `19.0.2` | React 19 typings. |
| `@types/better-sqlite3` | `^7.6.12` | SQLite typings. |
| `@types/ws`, `@types/xml2js` | `^8.5.13`, `^0.4.14` | Connector typings. |
| `pnpm` | `10.33.2` | Workspace package manager. Pinned in `/package.json:packageManager`. Activate via `corepack prepare pnpm@10.33.2 --activate`. |

There is **no ESLint configuration** in any workspace. `pnpm lint` runs `next lint` only inside `apps/web/`. There are **no Prettier or Husky hooks**.

## Build and run scripts

```jsonc
// /package.json
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

`pnpm test` is wired but no workspace defines a `test` script, so it's a no-op (see [how-to-contribute/testing](../how-to-contribute/testing.md)).

| Workspace | dev | build | start | typecheck | lint |
|---|---|---|---|---|---|
| `@overwatch/web` | `next dev -p 3311` | `next build` | `next start -p 3311` | `tsc --noEmit` | `next lint` |
| `@overwatch/fabric` | `tsx watch src/index.ts` | (none) | `tsx src/index.ts` | `tsc --noEmit` | (none) |
| `@overwatch/connectors` | (none) | (none) | (none) | `tsc --noEmit` | (none) |
| `@overwatch/schemas` | (none) | (none) | (none) | `tsc --noEmit` | (none) |

## Workspace aliases

`tsconfig.base.json` maps the workspace packages directly to source — no build step:

```json
"paths": {
  "@overwatch/schemas":    ["packages/schemas/src/index.ts"],
  "@overwatch/connectors": ["packages/connectors/src/index.ts"]
}
```

Consumers compile the source directly. The `package.json` of each leaf points `main` and `types` at the same `.ts` file, so external tooling (Next.js, tsx) resolves the same entry. See [how-to-contribute/patterns-and-conventions § imports](../how-to-contribute/patterns-and-conventions.md#imports).

## Security

The codebase has three identifiable security boundaries; each is reinforced by a specific code path.

### AES-256-GCM keystore (`apps/fabric/src/db.ts`)

Connector configs frequently contain API keys. They are encrypted at rest with AES-256-GCM:

```ts
function getOrMakeKey(): Buffer {
  try { return fs.readFileSync(KEY_PATH); }
  catch {
    mkdirSync(dirname(KEY_PATH), { recursive: true });
    const k = crypto.randomBytes(32);
    fs.writeFileSync(KEY_PATH, k, { mode: 0o600 });
    return k;
  }
}
const KEY = getOrMakeKey();

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(b64: string): string {
  const buf = Buffer.from(b64, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}
```

Properties:
- 32-byte key generated on first boot at `OVERWATCH_KEY_PATH` (default `./data/key.bin`) with `mode: 0o600`. Per-install, random, **not derived from a passphrase**.
- 12-byte IV per write; 16-byte GCM tag concatenated as `iv || tag || ciphertext`, then base64.
- Used by the orchestrator before `upsertInstance(...)` (`apps/fabric/src/orchestrator.ts`).
- `decrypt()` will throw on tag mismatch — the connector simply fails to load.

If the key file is lost, every `connector_instances.config` blob becomes unrecoverable.

### COOP/COEP headers (`apps/web/next.config.mjs`)

```js
async headers() {
  return [{
    source: "/(.*)",
    headers: [
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
    ],
  }];
}
```

These two headers are required so that:
- `SharedArrayBuffer` is available to transformers.js for multi-threaded WASM.
- WebGPU adapter detection works without the cross-origin isolation lock-out.
- The Cesium/MapLibre worker assets loaded from the Cesium CDN can be embedded via `credentialless`.

`credentialless` (rather than `require-corp`) avoids the need for every external asset to send `Cross-Origin-Resource-Policy` headers explicitly.

### Overseer sandbox (`apps/web/src/lib/agent.ts`)

The autonomous agent is restricted to a fixed allowlist of action types and a DOM-attribute allowlist for clicks:

```ts
case "click": {
  const el = document.querySelector<HTMLElement>(`[data-agent="${a.target}"]`);
  if (!el) return `no element data-agent="${a.target}"`;
  el.click();
  return `clicked ${a.target}`;
}
```

Constraints:
- Only twelve action verbs are accepted by `executeAction()` (`click`, `flyTo`, `flyToTopEvent`, `setView`, `toggleNightVision`, `openAnalyst`, `openOverseer`, `navigate`, `selectCategory`, `selectSeverity`, `clearFilters`, `say`, `stop`).
- `click` requires the target element to carry a `data-agent="..."` attribute. There is no string-literal or selector mode.
- `navigate` rejects anything that does not start with `/`.
- The mission has a step budget (`1..20`); after that the loop exits.
- The user can press Esc / Stop at any time; `shouldStop()` is checked on every iteration.

`collectOutline()` filters `data-agent` values starting with `event-` or `camera-` so the model isn't fed hundreds of dynamic targets — but those are still clickable through `data-agent="..."` if the model guesses the exact ID.

Threats this design does not mitigate include prompt injection from event titles and the agent's ability to drive the dashboard into expensive operations (lots of model loads, lots of fly-tos, navigating between routes). See [reference/security](./security.md) for the full threat model.

## See also

- [overview/getting-started](../overview/getting-started.md) — environment setup.
- [reference/configuration](./configuration.md) — env vars and REST/WS surface.
- [reference/security](./security.md) — full threat model and gaps.
- [reference/deployment](./deployment.md) — how the dependencies are bundled into Docker images.
