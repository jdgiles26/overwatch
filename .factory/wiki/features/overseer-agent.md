# Overseer agent

An autonomous agent that drives the dashboard. The user gives it a one-line mission (e.g. *"Switch to 3D globe and fly to the highest-severity event"*), a step budget, and a Start button. The agent then loops: screenshot the viewport, caption it, snapshot the live state, prompt SmolLM2-360M, parse a single JSON action, execute it. Repeat until the model emits `{"action":"say",...}` or the budget runs out.

## Surface area

| Concern | File |
|---|---|
| UI chrome | `apps/web/src/components/OverseerPanel.tsx` |
| Planner / executor | `apps/web/src/lib/agent.ts` |
| Vision captioning | `apps/web/src/lib/ai.ts` (`runVisionCaption`) |
| Sandbox | `data-agent="…"` attributes throughout `apps/web/src/components/*` |

## The action vocabulary

The system prompt in `apps/web/src/lib/agent.ts` declares an exact set of allowed JSON shapes:

```
{"action":"click","target":"<data-agent value>"}
{"action":"flyToTopEvent"}
{"action":"flyTo","lat":<num>,"lon":<num>,"zoom":<num>}
{"action":"setView","value":"map3d"|"map2d"|"split"}
{"action":"toggleNightVision","value":true|false}
{"action":"openAnalyst","value":true|false}
{"action":"openOverseer","value":false}
{"action":"navigate","value":"/connectors" | "/"}
{"action":"selectCategory","value":"weather"|"seismic"|...}
{"action":"selectSeverity","value":"info"|"low"|"moderate"|"high"|"extreme"}
{"action":"clearFilters"}
{"action":"say","value":"final summary including any findings"}
{"action":"stop","value":"why"}
```

The dispatcher in `executeAction(...)` mirrors the vocabulary one-for-one. Anything outside this set returns `unknown action ${a.action}` and the loop continues with that string as the next `LAST` value.

The `click` action is the broad escape hatch: it fires `el.click()` on any DOM node whose `data-agent="…"` attribute matches `target`. Most other actions are sugar over store mutations the agent could in principle reach via `click` if those buttons existed.

## The loop

`apps/web/src/lib/agent.ts → runOverseer`:

```ts
for (let i = 0; i < budget; i++) {
  if (shouldStop()) return;
  while (isPaused()) { await sleep(200); if (shouldStop()) return; }

  onProgress?.("Capturing viewport…");
  const blob = await captureScreenshot();
  let caption = "";
  if (blob) {
    try { caption = await runVisionCaption({ blob, onProgress }); }
    catch { caption = "(vision unavailable)"; }
  }

  const outline = collectOutline();
  const snapshot = liveSnapshot();
  onProgress?.("Reasoning…");
  const userMessage = `MISSION: ${mission}
BUDGET: ${budget}
STEP: ${i + 1}
LAST: ${lastResult}
TARGETS:
${outline}
LIVE:
${snapshot}
VISION: ${caption}
Return ONE JSON action.`;

  // ...prompt the model, parse the response, execute...
}
```

So each step prompt contains: the mission, the step counter, the previous result, a deduplicated list of clickable targets, a compact live-state snapshot, and a vision caption. Total prompt size is intentionally small — the smaller the prompt, the faster SmolLM2-360M completes. An oversized outline is one of the easier ways to time out the model.

The model is hard-coded:

```ts
runChat({
  model: "HuggingFaceTB/SmolLM2-360M-Instruct",
  messages: [
    { role: "system", content: SYSTEM },
    { role: "user", content: userMessage },
  ],
  maxNewTokens: 220,
  temperature: 0.2,
  // …
})
```

`temperature: 0.2` keeps the JSON well-formed; `maxNewTokens: 220` is enough for one action plus a short preamble but not enough for the model to ramble. SmolLM2-360M is the smallest model that reliably produces valid JSON in this prompt.

## Screenshot capture

The agent prefers reading directly from the visible WebGL canvas. The Cesium globe and MapLibre 2D both have `preserveDrawingBuffer: true` (set in `apps/web/src/components/Map3D.tsx` and `Map2D.tsx`), which lets `canvas.toBlob()` actually return pixels:

```ts
async function captureScreenshot(): Promise<Blob | null> {
  try {
    const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>("canvas"));
    const visible = canvases
      .filter((c) => {
        const r = c.getBoundingClientRect();
        return r.width > 200 && r.height > 200;
      })
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return br.width * br.height - ar.width * ar.height;
      });
    const target = visible[0];
    if (target) {
      const blob = await new Promise<Blob | null>((resolve) =>
        target.toBlob((b) => resolve(b), "image/jpeg", 0.85),
      );
      if (blob && blob.size > 1024) return blob;
    }
  } catch { /* fall through */ }

  try {
    const { toBlob } = await import("html-to-image");
    return await toBlob(document.body, {
      pixelRatio: 0.5,
      cacheBust: true,
      filter: (n) =>
        !(n instanceof Element &&
          (n.classList?.contains("cesium-widget-credits") || n.tagName === "VIDEO")),
    });
  } catch { return null; }
}
```

Fallback path: dynamic-imported `html-to-image` rasterises `document.body` at 0.5× pixel ratio, skipping the Cesium credits overlay and any `<video>` elements. The `<video>` filter avoids capturing the camera tiles, which would CORS-fail.

A captured blob smaller than 1024 bytes is treated as failure (most likely an empty WebGL frame). The fallback handles that case too.

## Vision captioning

`apps/web/src/lib/ai.ts → runVisionCaption`:

```ts
export async function runVisionCaption(args: { blob: Blob; onProgress? }): Promise<string> {
  const { RawImage } = await getTransformers();
  const device = await detectDevice();
  const captioner = await getOrCreatePipeline(
    "image-to-text",
    "Xenova/vit-gpt2-image-captioning",
    device,
    device === "webgpu" ? "fp16" : "q8",
    args.onProgress,
  );
  const url = URL.createObjectURL(args.blob);
  try {
    const img = await RawImage.read(url);
    const out = await captioner(img);
    const text = Array.isArray(out)
      ? out.map((o: any) => o.generated_text).join(" ")
      : out.generated_text;
    return text ?? "";
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

The captioner is `Xenova/vit-gpt2-image-captioning` — an old but small ViT+GPT2 model that runs comfortably on WebGPU and produces 1–2 sentence captions. It is cached by the same `getOrCreatePipeline` keyed on `image-to-text:Xenova/vit-gpt2-image-captioning:webgpu:fp16`. The `OverseerPanel` mentions "SmolVLM/ViT" in its footer text — the actual model is plain ViT-GPT2 today.

## collectOutline

```ts
function collectOutline(): string {
  const els = Array.from(document.querySelectorAll<HTMLElement>("[data-agent]"));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const el of els) {
    const tag = el.dataset.agent ?? "?";
    if (tag.startsWith("event-") || tag.startsWith("camera-")) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 50);
    out.push(`- ${tag} :: "${text}"`);
    if (out.length >= 60) break;
  }
  return out.join("\n");
}
```

Two filters worth noting:

- **`event-` and `camera-` prefixes are excluded.** `IntelFeed.tsx` tags every event row as `data-agent="event-${e.id}"` and `CameraStrip.tsx` tags every camera tile as `data-agent="camera-${camera.id}"`. With hundreds of events these would drown the prompt; the model would see the same generic "click an event" target dozens of times. Excluding them keeps the menu finite.
- **Deduplication on `tag`.** If the page has two buttons with `data-agent="view-3d"` (it doesn't, but defensively), the second one is dropped. The first 50 characters of `textContent` are appended so the model can read "view-3d :: 3D Globe".
- **Hard cap at 60 items.** Roughly the size of a static menu.

## liveSnapshot

```ts
function liveSnapshot(): string {
  const s = useStore.getState();
  const tc = s.threatcon;
  const top = s.events
    .filter((e) => e.severity !== "info")
    .slice(0, 5)
    .map((e) => `${e.severity}/${e.category} ${e.title}${
      e.geo ? ` @ ${e.geo.lat.toFixed(2)},${e.geo.lon.toFixed(2)}` : ""
    }`);
  const pir = s.pirs.map((p) => `${p.question} -> ${p.answer}`);
  return [
    tc ? `THREATCON ${tc.score} (${tc.level})` : "THREATCON pending",
    `Top: ${top.join(" | ") || "(quiet)"}`,
    `PIR: ${pir.join(" | ")}`,
    `Active feeds: ${s.status.filter((x) => x.connected).length}/${s.status.length}`,
    `View: ${s.view}, NightVision: ${s.nightVision}`,
  ].join("\n");
}
```

Compact and stable. The agent gets enough state to choose a sensible action without seeing the full event list.

## The early-stop trick

The model is asked to return *exactly one* JSON object. It often does so within the first 80–120 tokens, then keeps generating because `max_new_tokens=220`. The agent watches the streaming text and interrupts as soon as a complete JSON object containing `"action"` appears:

```ts
let raw = "";
let handleRef: { stop: () => void } | null = null;
let earlyCalled = false;
const tryEarlyStop = () => {
  if (earlyCalled || !handleRef) return;
  if (raw.includes('"action"') && /\{[\s\S]*?"action"[\s\S]*?\}/.test(raw)) {
    earlyCalled = true;
    handleRef.stop();
  }
};
const handle = await runChat({
  model: "HuggingFaceTB/SmolLM2-360M-Instruct",
  messages: [...],
  maxNewTokens: 220,
  temperature: 0.2,
  onProgress,
  onToken: (t) => { raw += t; tryEarlyStop(); },
});
handleRef = handle;
tryEarlyStop();                 // covers the case where the JSON streamed before the handle resolved
raw = (await handle.done) || raw;
```

The `tryEarlyStop()` after `handleRef = handle` handles the race where `runChat` already generated all tokens before its returned `handle` was assigned. Without it, the agent waits for the full 220-token horizon on every step, which roughly triples the per-step latency on WebGPU.

## Action parsing

`parseAction` is more forgiving than the analyst's regex. It tries fenced code blocks first, then iterates every `{...}` substring containing the literal `"action"`:

```ts
function parseAction(raw: string): { action: string; [k: string]: any } | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    const tryObj = tryJson(fenced[1] ?? "");
    if (tryObj) return tryObj;
  }
  const re = /\{[\s\S]*?\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (!m[0].includes('"action"')) continue;
    const obj = tryJson(m[0]);
    if (obj && typeof obj.action === "string") return obj;
  }
  return null;
}
```

`tryJson` falls back to a cleaned variant that strips trailing commas and converts `'key':` to `"key":`. SmolLM2 occasionally emits single-quoted keys; this catches those.

If parsing fails entirely, the loop sets `lastResult = "Could not parse action. Stopping."` and breaks early.

## executeAction dispatcher

`executeAction` is a `switch` over the action vocabulary. Highlights:

- **`click`** — `document.querySelector('[data-agent="${target}"]')` then `el.click()`. Returns `no element data-agent="..."` if missing.
- **`flyToTopEvent`** — sorts events by severity rank, picks the first with `geo`, calls `requestFlyTo` and `selectEvent` on the store. Returns `flew to "${title}" (${severity}) at ${lat},${lon}`.
- **`navigate`** — only honours values starting with `/`. `location.assign(value)` triggers a full reload, which kills the agent loop. The agent must therefore call `say` before navigating if it wants to leave a trace.
- **`say`** / **`stop`** — both break the for-loop. `say.value` is conventionally the final answer; `stop.value` is the abort reason.

Each action returns a string that becomes the next `LAST` value, giving the model a memory of what just happened.

## OverseerPanel UI

`apps/web/src/components/OverseerPanel.tsx` is the chrome:

- **Mission textarea** (2 rows) + four preset missions. Disabled while running.
- **Step budget input** (1–20).
- **Start / Pause / Stop buttons** with `data-agent="overseer-start"`. Esc fires `stopRef.current = true; setRunning(false)`.
- **Step transcript** — one card per step showing the model's text-before-the-JSON ("thought"), the parsed action, the vision caption, and the result line. The caption is rendered in italic grey and prefixed with `vision:`.
- **Footer**: `"Sandboxed: clicks restricted to whitelisted targets. WebGPU vision via SmolVLM/ViT."`

`stopRef` is a `useRef<boolean>` so the running async loop can poll it cheaply via `shouldStop()`. `paused` is plain React state and `isPaused()` reads it; the loop sleeps in 200 ms increments while paused.

## Esc-to-abort

The `OverseerPanel` registers a window keydown listener:

```ts
useEffect(() => {
  function escTriple(e: KeyboardEvent) {
    if (!running) return;
    if (e.key === "Escape") {
      stopRef.current = true;
      setRunning(false);
    }
  }
  window.addEventListener("keydown", escTriple);
  return () => window.removeEventListener("keydown", escTriple);
}, [running]);
```

Single Escape press, despite the function name. The agent checks `shouldStop()` on every iteration and after `await handle.done`, so the abort takes effect on the next tick.

## Sandbox properties

The agent cannot:
- Run arbitrary scripts (no `eval`-equivalent action).
- Access state outside the `useStore` shape (no DOM-write actions, no `fetch` action).
- Click any element without a `data-agent` attribute.
- Persist anything across reloads (no `navigate` to external URLs; `value` must start with `/`).

It can:
- Read everything the user can (live state, screenshot, vision caption).
- Toggle filters, views, panels.
- Navigate to `/`, `/connectors`, `/rules` (any path starting with `/`).

The combination is a "least-privilege drone" — useful for demos and demonstrably safer than a model that can call `eval`.

## End-to-end timing

1. User types "Switch to 3D globe and fly to the highest-severity event." Hits Start.
2. `runOverseer({mission, budget=8, ...})` is called. `detectDevice()` emits `webgpu`.
3. **Step 1.** Screenshot the canvas. ViT-GPT2 captions: *"a screen shot of a computer with a map of the world"*. Outline includes `view-3d`, `view-2d`, `view-split`, `analyst-toggle`, etc. Live snapshot: `THREATCON 3.4 (guarded)…`. Prompt sent to SmolLM2-360M.
4. Model emits `{"action":"setView","value":"map3d"}`. `executeAction` calls `s.setView("map3d")`. `lastResult = "view=map3d"`.
5. **Step 2.** New screenshot now shows the Cesium globe. Caption: *"a 3d globe with green dots"*. Model emits `{"action":"flyToTopEvent"}`. `executeAction` finds the highest-severity event with `geo`, calls `requestFlyTo` and `selectEvent`. `lastResult = 'flew to "M5.2 quake near Vallejo" (high) at 38.12,-122.32'`.
6. **Step 3.** Caption: *"a close up of a city on a globe"*. Model emits `{"action":"say","value":"Switched to 3D globe; flew to top event 'M5.2 quake near Vallejo'."}`. Loop breaks.

Each step typically takes 4–8 seconds on WebGPU (the screenshot + caption is the slow part; the SmolLM completion is ~2 s).

## Limits worth knowing

- **No web access from the agent.** It cannot run `fetch` or `XMLHttpRequest`. To bring in external data, expose a connector and let it land in the events store.
- **No native confirmation dialogs.** A `navigate("/")` to a destructive route would just navigate. Today there are no destructive routes.
- **Vision is best-effort.** ViT-GPT2 captions are flavourful at best. Don't rely on the agent reading text off the screen — it cannot OCR.
- **Step budget defaults to 8.** Anything over 12 starts to feel slow. The hard maximum is 20.
- **No conversation history.** Each step's prompt is rebuilt from scratch — there is no scrolling chat. The `LAST` line is the only memory.
- **No "explain my plan" mode.** The model emits one action per step, not a multi-step plan up front.

## Related pages

- [features/ai-analyst](./ai-analyst.md) — the read-only chat sibling that shares `runChat`.
- [features/voice-mode](./voice-mode.md) — Whisper STT + browser TTS used by the analyst, not the overseer.
- [apps/web § OverseerPanel](../apps/web.md#overseerpanel) — the surrounding UI chrome.
- [overview/glossary](../overview/glossary.md) — "Overseer", "Sandbox".
- [overview/fun-facts](../overview/fun-facts.md) — why `event-` and `camera-` are filtered out.
