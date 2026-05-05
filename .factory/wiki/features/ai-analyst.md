# AI Analyst

A right-rail chat panel powered by an in-browser LLM. The model runs entirely on the client via [Hugging Face Transformers.js](https://huggingface.co/docs/transformers.js/) on top of ONNX Runtime Web, with a WebGPU-first / WASM-fallback execution path. There is no LLM call to a server; the page downloads the weights to the browser cache on first use and runs every subsequent token locally.

## Surface area

| Concern | File |
|---|---|
| Chat UI | `apps/web/src/components/AnalystPanel.tsx` |
| Pipeline cache + ORT bring-up | `apps/web/src/lib/ai.ts` |
| Voice STT/TTS | `apps/web/src/lib/voice.ts` (see [features/voice-mode](./voice-mode.md)) |
| Briefing route | `apps/fabric/src/index.ts` (`GET /api/briefing-context`) |
| COOP/COEP headers | `apps/web/next.config.mjs` |

## Model picker

The panel exposes four models via a `<select>` in `AnalystPanel.tsx`:

```tsx
<option value="HuggingFaceTB/SmolLM2-360M-Instruct">SmolLM2-360M</option>
<option value="HuggingFaceTB/SmolLM2-1.7B-Instruct">SmolLM2-1.7B</option>
<option value="onnx-community/Qwen2.5-0.5B-Instruct">Qwen2.5-0.5B</option>
<option value="onnx-community/Llama-3.2-1B-Instruct">Llama-3.2-1B</option>
```

The default on first render is `SmolLM2-360M` (`useState("HuggingFaceTB/SmolLM2-360M-Instruct")`) — the smallest model that can still do the briefing prompt with reasonable structure. Switching the picker does not unload the previous pipeline; both stay cached (see Caching below). The Overseer agent always uses `SmolLM2-360M` regardless of what the analyst panel is set to (see [features/overseer-agent](./overseer-agent.md)).

## Device selection

`apps/web/src/lib/ai.ts → detectDevice()`:

```ts
export async function detectDevice(): Promise<"webgpu" | "wasm"> {
  if (typeof navigator !== "undefined" && (navigator as any).gpu) {
    try {
      const adapter = await (navigator as any).gpu.requestAdapter();
      if (adapter) return "webgpu";
    } catch {
      /* ignore */
    }
  }
  return "wasm";
}
```

It probes `navigator.gpu.requestAdapter()` — note the **adapter** check, not just the existence of the `gpu` object. Browsers behind a flag may expose `navigator.gpu` but fail to return an adapter. If the adapter exists, the analyst loads on WebGPU; otherwise it falls back to WASM.

The dtype is paired with the device:

```ts
device === "webgpu" ? "q4f16" : "q4"
```

WebGPU runs the 4-bit-quantised f16 weights; WASM runs the 4-bit-quantised int weights. The `runChat` flow can also recover from a WebGPU init failure mid-load:

```ts
} catch (e) {
  if (device === "webgpu") {
    onProgress?.("WebGPU init failed; falling back to WASM…");
    return getOrCreatePipeline(task, model, "wasm", "q4", onProgress);
  }
  throw e;
}
```

A failed WebGPU pipeline is **not** poisoned in the cache — the `_pipelineCache.set` call only runs on success, so the fallback pipeline is the one that gets cached.

## Pipeline cache

```ts
const _pipelineCache = new Map<string, any>();
const _pipelineLoading = new Map<string, Promise<any>>();
```

The cache key is `${task}:${model}:${device}:${dtype}`. So the same model loaded once on WebGPU and once on WASM keeps two separate entries. The `_pipelineLoading` map deduplicates concurrent loads of the same key — if two `runChat` calls fire before the model is ready, both await the same in-flight promise rather than each downloading 200 MB.

Pipelines are constructed with a `progress_callback` that maps Transformers.js events to a single `onProgress(string)` line. Status values: `download`, `initiate`, `progress` (with a percent), `ready`. Anything else is silently dropped.

`SESSION_OPTIONS` are passed through to the underlying ORT session:

```ts
const SESSION_OPTIONS = {
  logSeverityLevel: 3, // 0 verbose, 1 info, 2 warning, 3 error, 4 fatal
  logVerbosityLevel: 0,
};
```

These suppress the "VerifyEachNodeIsAssignedToAnEp" warnings ORT prints when ops fall back to CPU. See *Console filter* below.

## Streaming generation

`runChat` wraps `pipeline("text-generation", ...)`. The streaming surface uses two Transformers.js helpers:

```ts
const { TextStreamer, InterruptableStoppingCriteria } = await getTransformers();
// …
const stopping = InterruptableStoppingCriteria
  ? new InterruptableStoppingCriteria()
  : null;

const streamer = new TextStreamer(generator.tokenizer, {
  skip_prompt: true,
  skip_special_tokens: true,
  callback_function: (text: string) => {
    if (aborted) return;
    if (text) {
      acc += text;
      args.onToken?.(text);
    }
  },
});
```

The handle returned to callers is:

```ts
export interface RunChatHandle {
  done: Promise<string>;   // resolves to the full generated text
  stop: () => void;        // aborts generation (sets `aborted = true` and calls stopping?.interrupt())
}
```

`AnalystPanel.tsx` calls `await handle.done` after streaming finishes. There is a deliberate "wait for `done`" before flipping the busy state off — without that, a fast-streaming model can emit tokens while the generation is still pinned on the GPU, which hurts subsequent prompts.

Default generation parameters in `runChat`:

```ts
{
  max_new_tokens: args.maxNewTokens ?? 256,
  do_sample: true,
  temperature: args.temperature ?? 0.5,
  top_p: 0.9,
  repetition_penalty: 1.05,
}
```

The chat loop calls `runChat` with no overrides (so 256 tokens, 0.5 temp). The briefing path uses `maxNewTokens: 360, temperature: 0.3` (see [features/briefing-generator](./briefing-generator.md)).

There is a fallback for non-streaming pipelines: if `acc` is empty when the underlying generator resolves, the code reads `out[0].generated_text` (or `out.generated_text`) as the final text. None of the current four models hit this path in practice, but it keeps the contract honest.

## Live context

Every chat send builds a small "live context" string and prepends it to the system prompt:

```ts
function buildContext(args: { events, tc, pirs, status }) {
  const top = args.events.slice(0, 12).map(
    (e) => `- [${e.severity}] ${e.category} • ${e.title} ${
      e.geoMentioned ? `(${e.geoMentioned})` : ""
    }`,
  );
  const pir = args.pirs.map((p) => `- ${p.question} → ${p.answer}`);
  const tc = args.tc
    ? `THREATCON ${args.tc.score} (${args.tc.level}). Reasons: ${args.tc.reasons.join("; ") || "none"}.`
    : "";
  const sources = args.status
    .filter((s) => s.connected)
    .map((s) => s.label)
    .slice(0, 10)
    .join(", ");
  return `${tc}\nTop events:\n${top.join("\n")}\nPIRs:\n${pir.join("\n")}\nLive sources: ${sources}`;
}
```

So every prompt includes:

- The current THREATCON score, level, and reasons.
- The 12 most recent events (in store order, not severity order).
- All six PIRs as `question → answer`.
- Up to 10 connected source labels.

The system prompt then adds a generic instruction block:

```
You are OverWatch Analyst, a concise OSINT/IoT intelligence assistant.
You see live event metadata. Always cite event titles by name.
If asked to plot or focus, respond with a JSON block like {"action":"flyTo","lat":..,"lon":..,"zoom":..}.
You may answer Priority Intelligence Requirements (PIRs) directly.
Keep responses under 120 words unless asked.
```

The chat history is filtered to `system | user | assistant` roles only — the schema also allows `tool` messages but they're never sent to the model.

## flyTo JSON parsing

After a chat response settles, the panel scans the result for a `flyTo` action:

```ts
const m = result.match(/\{\s*"action"\s*:\s*"flyTo"[^}]*\}/);
if (m) {
  try {
    const obj = JSON.parse(m[0]);
    if (obj.lat != null && obj.lon != null)
      flyTo({ lat: obj.lat, lon: obj.lon, zoom: obj.zoom ?? 6 });
  } catch { /* ignore */ }
}
```

This is a deliberately *conservative* extractor: only the `flyTo` action is parsed, only one match per response, and any malformed JSON is silently ignored. The Overseer agent has a more permissive parser for its own action vocabulary; the analyst is read-only by comparison.

## EventDetail integration

`AnalystPanel.tsx` listens for a custom DOM event:

```ts
useEffect(() => {
  function onPrompt(ev: Event) {
    const detail = (ev as CustomEvent).detail;
    if (typeof detail === "string") {
      setInput(detail);
    }
  }
  window.addEventListener("overwatch:analyst-prompt", onPrompt);
  return () => window.removeEventListener("overwatch:analyst-prompt", onPrompt);
}, []);
```

`EventDetail.tsx`'s "Ask analyst" button dispatches:

```ts
window.dispatchEvent(new CustomEvent("overwatch:analyst-prompt", {
  detail: `Brief me on the event "${e.title}" — what should I monitor?`,
}));
```

The handler only sets the input field — it does not auto-send. The user still has to press Enter (or wait for the voice mic to fire `setTimeout(() => send(text), 50)`).

## ORT console filter

`apps/web/src/lib/ai.ts → installConsoleFilter()` patches `console.error` once per page load. ORT prints a handful of "ops fell back to CPU" warnings to `console.error` despite them being purely informational. Next.js's dev overlay escalates every `console.error` to a red toast, so the patch routes them to `console.debug` instead:

```ts
const NOISY = [
  /VerifyEachNodeIsAssignedToAnEp/i,
  /some nodes were not assigned to the preferred execution providers/i,
  /Rerunning with verbose output/i,
  /CleanUnusedInitializersAndNodeArgs/i,
  /\bW:onnxruntime/i,
  /\bI:onnxruntime/i,
  /ort-wasm/i,
];
console.error = (...args: any[]) => {
  const text = args.map((a) => (typeof a === "string" ? a : a?.message ?? "")).join(" ");
  if (text && NOISY.some((re) => re.test(text))) {
    console.debug("[ort]", ...args);
    return;
  }
  orig(...args);
};
```

Seven patterns total. The original `console.error` is preserved for everything else. See [overview/fun-facts](../overview/fun-facts.md).

The companion `env` tweaks are also applied once on first import:

```ts
env.allowLocalModels = false;
env.useBrowserCache = true;
env.logLevel = "error";
env.backends.onnx.logLevel = "error";
env.backends.onnx.wasm.logLevel = "error";
env.backends.onnx.webgpu.logLevel = "error";
if (typeof SharedArrayBuffer === "undefined") {
  env.backends.onnx.wasm.numThreads = 1;
}
```

## next.config.mjs

WebGPU + threaded WASM both require cross-origin isolation, which Next.js controls via two response headers:

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

`credentialless` was chosen over `require-corp` so that third-party tile servers (OSM, Cesium CDN) load without needing CORP headers on each tile. The same configuration also sets:

```js
serverExternalPackages: [
  "@huggingface/transformers",
  "onnxruntime-node",
  "sharp",
],
webpack: (config, { isServer }) => {
  if (!isServer) {
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      "onnxruntime-node": false,
      sharp: false,
      fs: false,
      path: false,
      crypto: false,
    };
  }
  return config;
},
```

`onnxruntime-node` is the Node-bound ORT used during SSR; the browser bundle stubs it to `false` so webpack doesn't try to bundle native binaries. `serverExternalPackages` keeps the Node package out of the server bundle entirely (Next.js 15 syntax).

## End-to-end timing

1. User opens the analyst panel (Cmd+K → "analyst", or the Top Bar toggle).
2. Types "Any earthquakes M4+?" and hits Enter.
3. `send()` builds the live context, appends prior messages, and calls `runChat({ model, messages, onToken, ... })`.
4. `runChat` calls `getTransformers()` (lazy import, installs console filter, sets ORT env). On first call this triggers the dynamic import of `@huggingface/transformers`.
5. `detectDevice()` returns `"webgpu"` (Chromium 113+ on a discrete GPU).
6. `getOrCreatePipeline("text-generation", model, "webgpu", "q4f16")` checks the cache — empty. Starts the load. The progress callback fires repeatedly with `Loading model.onnx_data: 7%`, etc., updating the small "Loading…" line above the input.
7. Once `ready`, the pipeline is cached. The tokenizer applies the model's chat template to the messages array.
8. Generation starts. Tokens stream in via `TextStreamer.callback_function`, each one accumulating in `acc` and pushed into the React message list.
9. The user clicks **Stop** mid-stream. `handle.stop()` sets `aborted = true` and calls `stopping.interrupt()`. The next token tick exits cleanly. `await handle.done` resolves with `acc` (the partial text).
10. The panel scans the final text for `{"action":"flyTo",...}`. None found, so no map fly happens.
11. If `ttsOn` is true, `speak(result)` is called from `apps/web/src/lib/voice.ts`. See [features/voice-mode](./voice-mode.md).

## Limits worth knowing

- **First load is heavy.** The smallest model (SmolLM2-360M) is roughly 200 MB after quantisation; Llama-3.2-1B is about 700 MB. They cache to IndexedDB so subsequent visits are instant, but a first-time visitor on a slow connection waits.
- **WebGPU support is browser-dependent.** Safari does not yet expose WebGPU at runtime by default. The fallback to WASM is graceful but slower.
- **Context is rebuilt every send.** Long-running chats do not accumulate context history into a vector store; the system prompt always includes the same `buildContext(...)` snapshot. The user's prior turns *are* threaded as `assistant`/`user` messages.
- **No safety filtering.** A user can prompt the model to ignore its system prompt. This is a single-user console; there is no abuse vector.
- **No tool use beyond `flyTo`.** The model can suggest other actions in JSON, but the panel only parses `flyTo`. Use the [Overseer agent](./overseer-agent.md) for multi-action plans.

## Related pages

- [features/overseer-agent](./overseer-agent.md) — the autonomous variant of this panel that *does* parse a wider action vocabulary.
- [features/voice-mode](./voice-mode.md) — Whisper STT + browser TTS.
- [features/briefing-generator](./briefing-generator.md) — the structured 5-section path.
- [apps/web § AnalystPanel](../apps/web.md#analystpanel) — the surrounding UI chrome.
- [overview/fun-facts](../overview/fun-facts.md) — why the console filter exists.
