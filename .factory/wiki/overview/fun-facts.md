# Fun facts

Things a maintainer would notice but a casual reader wouldn't. Each entry is grounded in a concrete file path and a line of code.

## The four empty workspaces

`packages/agent/`, `packages/ai/`, `packages/cv/`, and `packages/ui/` each contain a `package.json`, a `tsconfig.json`, and an empty `src/` directory. `pnpm-workspace.yaml` lists all four. Nothing in the repo imports anything from them.

```
% ls packages/agent/src packages/ai/src packages/cv/src packages/ui/src
(all four are empty)
```

The "real" code that would have lived in each has been folded inline:

- `packages/agent/` → `apps/web/src/lib/agent.ts`.
- `packages/ai/` → `apps/web/src/lib/ai.ts` and `apps/web/src/lib/voice.ts`.
- `packages/cv/` → `apps/web/src/components/cvWorker.ts`.
- `packages/ui/` → the `.panel` / `.btn` / `.input` Tailwind utility classes in `apps/web/src/app/globals.css` and the per-component JSX in `apps/web/src/components/*.tsx`.

See [overview/lore](./lore.md) for plausible explanations.

## The cross-bundle webhook router

`packages/connectors/src/sources/webhook.ts`:

```ts
declare global {
  var __overwatchWebhookRouter: Map<string, (body: any) => void> | undefined;
}
export function getWebhookRouter(): Map<string, (body: any) => void> {
  if (!globalThis.__overwatchWebhookRouter) {
    globalThis.__overwatchWebhookRouter = new Map();
  }
  return globalThis.__overwatchWebhookRouter;
}
```

This is a deliberate shared global. The Fastify route `POST /ingest/:key` (in `apps/fabric/src/index.ts`) needs to call back into the right webhook connector instance, but the connectors live in a separately-bundled package (`@overwatch/connectors`). Hanging the router off `globalThis` papers over the import-graph isolation with one declaration. Search the repo for `__overwatchWebhookRouter` — it's the only such global.

## The `console.error` patch

`apps/web/src/lib/ai.ts → installConsoleFilter()` and `apps/web/src/components/ConsoleFilter.tsx` both install the same patch (defensive double-mount: one fires when the AI library loads, the other fires when the React tree mounts).

The patched function rewrites any `console.error(...)` call whose joined text matches one of these regexes:

```ts
const NOISY = [
  /VerifyEachNodeIsAssignedToAnEp/i,
  /some nodes were not assigned to the preferred execution providers/i,
  /Rerunning with verbose output/i,
  /CleanUnusedInitializersAndNodeArgs/i,
  /\bW:onnxruntime/i,
  /\bI:onnxruntime/i,
  /ort-wasm/i,
  /CoreMLExecutionProvider/i,   // present only in components/ConsoleFilter.tsx
];
```

The `ConsoleFilter` variant has 8 patterns (it adds `CoreMLExecutionProvider` for Safari); the `lib/ai.ts` variant has 7. Both demote matches to `console.debug("[ort]", ...)` so Next.js's dev overlay doesn't escalate them to red error toasts.

## Cesium widget CSS injected at runtime

`apps/web/src/components/Map3D.tsx`:

```ts
if (!document.getElementById("cesium-widgets-css")) {
  const link = document.createElement("link");
  link.id = "cesium-widgets-css";
  link.rel = "stylesheet";
  link.href =
    "https://cesium.com/downloads/cesiumjs/releases/1.125/Build/Cesium/Widgets/widgets.css";
  document.head.appendChild(link);
}
(window as any).CESIUM_BASE_URL =
  "https://cesium.com/downloads/cesiumjs/releases/1.125/Build/Cesium/";
```

The Cesium widgets stylesheet is fetched from the official CDN at runtime, not bundled. The `CESIUM_BASE_URL` is set to the same CDN path so workers and assets resolve. This keeps Cesium's ~6 MB of CSS / fonts / shader files out of the Next.js build entirely. Trade-off: the dashboard requires internet on first 3D-globe view.

## `data/overwatch.db` and `data/key.bin` are committed

`apps/fabric/data/overwatch.db` (≈2 MB SQLite snapshot) and `apps/fabric/data/key.bin` (32-byte AES key) are both in the initial commit. That's how a fresh `git clone && pnpm install && pnpm --filter @overwatch/fabric dev` produces a populated demo without needing to run the seed script.

```
% file apps/fabric/data/overwatch.db
apps/fabric/data/overwatch.db: SQLite 3.x database, ...
```

For a public deployment, both files should be deleted before the first push — committing the keystore is fine for a single-author demo and a security risk for anything else.

## Overseer outline filters out dynamic targets

`apps/web/src/lib/agent.ts → collectOutline()`:

```ts
for (const el of els) {
  const tag = el.dataset.agent ?? "?";
  if (tag.startsWith("event-") || tag.startsWith("camera-")) continue;
  // ...
}
```

Without that filter, the `data-agent="event-${e.id}"` attributes set by `IntelFeed.tsx` (one per visible event row) and `data-agent="camera-${camera.id}"` set by `CameraTile.tsx` would dominate the agent's prompt with hundreds of opaque IDs. Filtering them keeps the menu finite (the `outline` is hard-capped at 60 items).

## hls.js is set to aggressive low-latency

`apps/web/src/components/CameraTile.tsx`:

```ts
hls = new Hls({ liveSyncDurationCount: 2, lowLatencyMode: true });
```

`liveSyncDurationCount: 2` tells hls.js to stay 2 segments behind the live edge — about 12 seconds for a typical 6-second-segment HLS stream. The default is 3. Combined with `lowLatencyMode: true`, this trades some buffer-underrun resilience for a noticeably less-laggy viewport on flaky networks.

## Both maps enable preserveDrawingBuffer just for screenshots

```ts
// apps/web/src/components/Map3D.tsx
contextOptions: { webgl: { preserveDrawingBuffer: true, alpha: true } },

// apps/web/src/components/Map2D.tsx
preserveDrawingBuffer: true,
```

`preserveDrawingBuffer` keeps the WebGL framebuffer alive between paints so `canvas.toBlob()` returns real pixels instead of an empty image. Both maps set it specifically so the [Overseer agent](../features/overseer-agent.md) can screenshot the canvas in `agent.ts → captureScreenshot()`. There is a small frame-rate cost to setting it (the GPU can't double-buffer optimally) — the cost is paid universally even when the agent isn't running.

## 0 tests, 0 TODOs, 0 FIXMEs in 12 KLOC

```
% rg --type ts -l 'describe\(|it\(|test\('
(no matches)
% rg --type ts 'TODO|FIXME'
(no matches)
% rg --type tsx 'TODO|FIXME'
(no matches)
```

A single-sitting build by a single contributor with zero comments admitting open questions. Either the author had nothing to flag or they cleaned the comments before committing. There is no `eslint.config.*` either; the dashboard uses Next.js's default `next/core-web-vitals` preset.

## radiusKm vs radius_km

The browser sends Locations with `radiusKm` (camelCase). The SQLite schema column is `radius_km` (snake_case). The translation is in `apps/fabric/src/db.ts → upsertLocation`:

```ts
db.prepare(
  `INSERT OR REPLACE INTO locations (id, label, lat, lon, radius_km, kind) VALUES (?,?,?,?,?,?)`,
).run(l.id, l.label, l.lat, l.lon, l.radiusKm ?? 25, l.kind ?? "home");
```

…and on the way back out, every read site explicitly maps `radius_km` → `radiusKm`:

```ts
// apps/fabric/src/index.ts:142
radiusKm: l.radius_km,
```

The schema (`packages/schemas/src/index.ts`) only knows the camelCase form. A maintainer who adds a new column has to remember to map both directions.

## SmolLM2-360M is the agent's hard-coded model

`apps/web/src/lib/agent.ts`:

```ts
const handle = await runChat({
  model: "HuggingFaceTB/SmolLM2-360M-Instruct",
  // ...
});
```

The Overseer always uses SmolLM2-360M regardless of what the analyst panel's model picker is set to. Switching the analyst to Llama-3.2-1B does not switch the agent; the agent stays at the smallest model because SmolLM2-360M produces JSON faster and with higher format compliance than the bigger models on this prompt.

## Voice STT runs on WASM, not WebGPU

`apps/web/src/lib/voice.ts`:

```ts
const pipe = await getOrCreatePipeline(
  "automatic-speech-recognition",
  "Xenova/whisper-tiny.en",
  "wasm",       // ← hard-coded
  "q8",
  () => undefined,
);
```

Every other model in the app prefers WebGPU when available (`detectDevice()` returns `"webgpu"` first). Whisper is the exception: the Whisper encoder uses ops that the ORT WebGPU EP either falls back to CPU for or runs slower than pure WASM. Hard-coding `"wasm"` skips the device detection entirely. The dtype is `q8` instead of the analyst's `q4`/`q4f16` because Whisper-tiny is small enough that 8-bit quantisation is the sweet spot for short utterances.

## TopicWorker exists but isn't wired in

`apps/web/src/components/topicWorker.ts` is a Web Worker that runs zero-shot classification with `Xenova/nli-deberta-v3-xsmall` against a fixed list of 12 tags ("weather emergency", "earthquake", "wildfire", …). Nothing in the dashboard imports or spawns it today (`rg topicWorker apps/web/src` returns no usage). It looks like the next planned feature: tagging incoming events with semantic topics for the Intel Feed. The file is also pinned to WASM with q8.

## EventDetail's relevance score is hand-tuned

`apps/web/src/components/EventDetail.tsx`:

```ts
if (other.connectorId === ev.connectorId) score += 1;
if (other.category === ev.category) score += 1;
if (ev.geo && other.geo && distanceKm(ev.geo, other.geo) < 100) score += 2;
if (ev.payload?.icao24 && other.payload?.icao24 === ev.payload.icao24) score += 5;
```

Same connector +1, same category +1, < 100 km away +2, same aircraft +5. The numbers are not configurable; an aircraft match outranks every other signal combined. There is no documentation of how the weights were chosen — they read like a single-author pass that happened to look right on test data.

## CV `severity` is hard-coded in CameraTile

`apps/web/src/components/CameraTile.tsx`:

```ts
severity: msg.label === "fire" ? "high" : "moderate",
```

Every fire detection becomes `severity: "high"`. Every other CV detection (motion, person, vehicle, plate, the shared `edgeScore` heuristic) becomes `severity: "moderate"`. The cv worker emits a `confidence` value, but the camera tile doesn't consult it — a 5%-confidence motion blob and a 99%-confidence motion blob are equally `moderate` to the rest of the system.

## All 22 connectors are free-tier or no-auth

Every entry in `packages/connectors/src/sources/*.ts` has `freeTier: true`. The five `authKind: "api-key"` connectors all *function* without a key (just rate-limited). `nasa-firms` is the closest to an exception — it requires a `NASA_FIRMS_MAP_KEY` to actually return data, but the registration is free. So the entire dashboard can be stood up with zero credit-card-bearing accounts.

## The IntelFeed icon table doesn't include "eye"

`apps/web/src/components/IntelFeed.tsx → EventIcon` maps `ev.icon` to a Lucide glyph:

```tsx
if (icon === "cloud-lightning") return <Bolt className={c} />;
if (icon === "waves") return <Waves className={c} />;
if (icon === "flame") return <Flame className={c} />;
// ... 12 more cases ...
return <Activity className={c} />;
```

The `cv-event` POST sets `icon: "eye"`, but there's no `if (icon === "eye")` branch. CV events therefore render with the generic `Activity` fallback in the feed. Adding one line would fix it.

## OpenSky's bbox default is hard-coded to CONUS

`packages/connectors/src/sources/opensky.ts`:

```ts
const Cfg = z.object({
  // ...
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).default([-125, 24, -66, 50]),
});
```

A user in Europe gets zero aircraft trails until they edit the connector config to widen or move the bbox. The default makes sense for a US-centric demo; it's surprising for everyone else.

## The seed script's RTSP demo references a fake stream

`scripts/seed-demo.ts`:

```ts
{
  id: "cam-rtsp-demo",
  label: "Demo RTSP (go2rtc)",
  source: "ffmpeg:https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
  kind: "rtsp",
  // ...
  whepUrl: "http://localhost:1984/api/webrtc?src=bigbuckbunny",
}
```

The `source` is `ffmpeg:`-prefixed so go2rtc transcodes it on the fly; the `whepUrl` is a separate go2rtc endpoint. Without go2rtc running, this camera tile shows "WHEP 404" forever. With `infra/docker-compose.yml`'s go2rtc sidecar, the same RTSP card serves a smooth WebRTC feed in <500 ms.

## Tailwind utility class naming is internally consistent

`apps/web/src/app/globals.css` defines five shared utilities — `.panel`, `.btn`, `.input`, `.scrollable`, `.badge` — and every component uses them instead of long Tailwind soup. Any change to "the panel chrome" updates every panel in the app via one line of CSS. This is the closest thing to a `packages/ui/` library the repo has.

## Related pages

- [overview/index](./index.md) — narrative overview.
- [overview/lore](./lore.md) — design-decision context.
- [overview/by-the-numbers](./by-the-numbers.md) — exact counts.
- [overview/architecture](./architecture.md) — process and data-flow diagrams.
