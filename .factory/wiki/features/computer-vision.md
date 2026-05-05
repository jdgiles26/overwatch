# Computer vision

Each camera tile can run lightweight pixel-heuristic detectors in a Web Worker. When a heuristic fires, the tile POSTs a `cv-event` to the fabric, which round-trips it back as a regular `IngestEvent` with `category: "cv"`. The IntelFeed and both maps treat it like any other event.

## Surface area

| Concern | File |
|---|---|
| Worker | `apps/web/src/components/cvWorker.ts` |
| Per-tile sampler | `apps/web/src/components/CameraTile.tsx` (the cv `useEffect`) |
| Fabric ingestion | `apps/fabric/src/index.ts` (`POST /api/cv-event`) |
| Camera schema | `packages/schemas/src/index.ts` (`CameraFeed.detectors`) |

## Per-tile worker spawn

`apps/web/src/components/CameraTile.tsx` spins up one worker per camera tile that has a non-empty `detectors` array:

```ts
useEffect(() => {
  if (!camera.detectors || camera.detectors.length === 0) return;
  const v = videoRef.current;
  const c = canvasRef.current;
  if (!v || !c) return;

  const w = new Worker(new URL("./cvWorker.ts", import.meta.url), { type: "module" });
  workerRef.current = w;
```

The `new URL("./cvWorker.ts", import.meta.url)` form is what Webpack 5 / Turbopack pick up to bundle the worker as a separate chunk. `type: "module"` enables ES module imports inside the worker (the worker doesn't currently use any, but the option keeps it future-proof).

There is **one worker per tile**. A dashboard with three cameras has three workers running in parallel. They do not share state.

## Sampling loop

Same effect, the inner tick:

```ts
let raf = 0;
const ctx = c.getContext("2d");
const tick = () => {
  if (!ctx || v.readyState < 2) {
    raf = requestAnimationFrame(tick);
    return;
  }
  c.width = 160;
  c.height = 90;
  ctx.drawImage(v, 0, 0, c.width, c.height);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  w.postMessage({ type: "frame", detectors: camera.detectors, data, ts: Date.now() });
  raf = window.setTimeout(() => requestAnimationFrame(tick), 1000) as unknown as number;
};
raf = requestAnimationFrame(tick);
```

Properties:

- **160×90 ImageData** — the source video is downsampled to a 16:9 thumbnail. 14 400 pixels total. The heuristics step through the buffer at stride 16, so each detector touches roughly 900 pixels per frame.
- **~1 Hz cadence.** `setTimeout(... , 1000)` between frames; the inner `requestAnimationFrame` only ensures the next sample lands on a paint boundary.
- **`v.readyState < 2`** — if the video hasn't received metadata yet, the loop yields without sampling.
- **Hidden canvas.** `<canvas ref={canvasRef} className="hidden" />` is the off-screen scratch buffer. It is not rendered; the user never sees it.
- **`postMessage` copies the ImageData.** The structured-clone overhead is negligible at 56 KB per frame.

The worker is `terminate()`'d in the cleanup, which kills the loop cleanly when the tile unmounts (camera removed, or the camera array re-renders for unrelated reasons).

## Three heuristics

`apps/web/src/components/cvWorker.ts`:

```ts
self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg.type !== "frame") return;
  const data: ImageData = msg.data;
  const detectors: string[] = msg.detectors ?? [];
  const now = Date.now();
  const findings: any[] = [];

  if (detectors.includes("motion")) {
    const score = motionScore(data, lastFrame);
    if (score > 0.04 && (now - (lastDetectAt.motion ?? 0)) > COOLDOWN_MS) {
      lastDetectAt.motion = now;
      findings.push({ label: "motion", confidence: Math.min(1, score * 6) });
    }
  }
  if (detectors.includes("fire")) {
    const score = fireHeuristic(data);
    if (score > 0.05 && (now - (lastDetectAt.fire ?? 0)) > COOLDOWN_MS) {
      lastDetectAt.fire = now;
      findings.push({ label: "fire", confidence: Math.min(1, score * 5) });
    }
  }
  if (detectors.includes("person") || detectors.includes("vehicle") || detectors.includes("plate")) {
    const score = edgeScore(data);
    if (score > 0.2 && (now - (lastDetectAt.shape ?? 0)) > COOLDOWN_MS) {
      lastDetectAt.shape = now;
      findings.push({ label: detectors[0]!, confidence: Math.min(1, score) });
    }
  }

  lastFrame = data;
  for (const f of findings) (self as any).postMessage({ type: "detection", ...f });
};
```

### motion

Frame-difference at stride 16 across all three RGB channels:

```ts
function motionScore(curr: ImageData, prev: ImageData | null): number {
  if (!prev || prev.data.length !== curr.data.length) return 0;
  let diff = 0;
  const data = curr.data;
  const p = prev.data;
  const step = 16;
  for (let i = 0; i < data.length; i += step) {
    const dr = Math.abs(data[i]! - p[i]!);
    const dg = Math.abs(data[i + 1]! - p[i + 1]!);
    const db = Math.abs(data[i + 2]! - p[i + 2]!);
    if (dr + dg + db > 80) diff++;
  }
  return diff / (data.length / step);
}
```

For each sampled pixel, sum the absolute deltas across R, G, B. If the sum exceeds 80, count that pixel as "moving". Score = moving pixels / sampled pixels. Trigger threshold `0.04`. Confidence is `min(1, score * 6)`.

Limitations: any global brightness change (clouds passing, autoexposure adjustments) trips it. A real ML detector is the next step; this is the smallest thing that registers genuine motion.

### fire

Looks for "warm" pixels:

```ts
function fireHeuristic(d: ImageData): number {
  const data = d.data;
  let hits = 0;
  let total = 0;
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (r > 180 && g < 140 && b < 90 && r - b > 80) hits++;
    total++;
  }
  return hits / Math.max(1, total);
}
```

The exact predicate: `R > 180 AND G < 140 AND B < 90 AND (R - B) > 80`. Tuned to flame-orange. False-positives include sunset skies, brake lights, and exposed brick. Threshold `0.05`. Confidence `min(1, score * 5)`. The fabric maps `fire` detections to `severity: "high"`; everything else from CV is `moderate`.

### edge / shape

A poor-man's "is something here":

```ts
function edgeScore(d: ImageData): number {
  const data = d.data;
  const w = d.width;
  let edges = 0;
  let total = 0;
  for (let y = 1; y < d.height - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const i = (y * w + x) * 4;
      const right = i + 4;
      const lum = data[i]! + data[i + 1]! + data[i + 2]!;
      const lumR = data[right]! + data[right + 1]! + data[right + 2]!;
      if (Math.abs(lum - lumR) > 90) edges++;
      total++;
    }
  }
  return edges / Math.max(1, total);
}
```

Iterate every other pixel, compare luma (RGB sum) against the right neighbour. Count it as an "edge" if the difference exceeds 90. Threshold `0.2`. Confidence `min(1, score)`.

This single function backs all three of `person`, `vehicle`, `plate`. The label that ends up on the `cv-event` is `detectors[0]!` — whichever the user listed first in `camera.detectors`. There is no semantic difference between them at this level. A maintainer who needs real classification swaps in a YOLO/MediaPipe model here.

## Cooldown

```ts
let lastDetectAt: Record<string, number> = {};
const COOLDOWN_MS = 6_000;
// ...
if (score > 0.04 && (now - (lastDetectAt.motion ?? 0)) > COOLDOWN_MS) {
  lastDetectAt.motion = now;
}
```

Each detector key is throttled to one fire every 6 seconds. The keys are `motion`, `fire`, and `shape` (the latter shared between `person` / `vehicle` / `plate`). With a 1 Hz sample rate this allows up to 10 firings per minute per camera per detector type — enough granularity that a sustained event produces multiple cards in the feed without flooding.

The cooldown lives in the worker module's top-level state, so it persists across frames but is reset whenever the tile remounts (the worker is `terminate()`d).

## Posting back to fabric

`CameraTile.tsx` listens on `worker.onmessage`:

```ts
w.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type === "detection") {
    setDetections((d) => d + 1);
    fetch("/fabric/api/cv-event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: `cv-${camera.id}-${Date.now()}`,
        title: `${msg.label} on ${camera.label}`,
        summary: `${(msg.confidence * 100).toFixed(0)}% confidence`,
        severity: msg.label === "fire" ? "high" : "moderate",
        geo: camera.geo,
        payload: msg,
      }),
    }).catch(() => undefined);
  }
};
```

The body shape:

- **`id`** — `cv-${camera.id}-${Date.now()}`. Millisecond resolution, so two firings on the same camera in the same millisecond would collide; with the 6 s cooldown that's not possible.
- **`title`** — `"motion on Driveway"`, `"fire on Barn camera"`, etc.
- **`summary`** — confidence as `"57% confidence"`.
- **`severity`** — `"high"` for fire, `"moderate"` for everything else.
- **`geo`** — copied from the camera's saved location. Detections inherit the camera's lat/lon.
- **`payload`** — the raw worker message: `{ label, confidence }`.

The badge counter `detections` increments on every firing, so the user sees "Eye 3" on the camera tile chrome.

The fetch is `.catch(() => undefined)` — failures are silently ignored. There's no retry, no offline queue.

## Fabric round-trip

`apps/fabric/src/index.ts → POST /api/cv-event`:

```ts
app.post("/api/cv-event", async (req, reply) => {
  const body = req.body as any;
  if (!body?.title) return reply.status(400).send({ error: "title required" });
  const full = {
    id: body.id ?? `cv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    source: body.source ?? "browser-cv",
    connectorId: "browser-cv",
    category: "cv" as const,
    severity: (body.severity as any) ?? "moderate",
    title: body.title,
    summary: body.summary,
    occurredAt: body.occurredAt ?? new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    geo: body.geo,
    icon: body.icon ?? "eye",
    payload: body.payload,
  };
  const { persistEvent } = await import("./db.js");
  persistEvent(full);
  broadcast({ type: "event", data: full });
  return { ok: true };
});
```

So the cv-event becomes a first-class `IngestEvent` with `connectorId: "browser-cv"`. It is persisted to `events`, broadcast as `{type:"event"}` to all WebSocket clients, and then evaluated by the alert rule engine like any other event.

The fabric does **not** validate the body against the `IngestEvent` schema explicitly here — only `title` is required. A malformed `severity` would slip through and propagate to the browser.

## Resulting downstream effects

Once the event lands:

- **IntelFeed.tsx** — the new `cv` category event renders with the eye icon (`icon: "eye"` falls back to the generic `Activity` Lucide glyph since there's no explicit case for "eye" in `EventIcon`). Severity colors apply normally.
- **Map3D.tsx / Map2D.tsx** — if `geo` was provided (only when the camera had `geo` saved), a dot appears at the camera's location. CV events inherit the camera's coordinates, so all detections from one camera plot on the same point.
- **AssessmentPanel.tsx → Severity mix** — a `moderate` cv detection counts toward the moderate slice; `fire` counts toward `high`.
- **PIR `cv-alert`** — flips to `yes` for any `cv` event in the last 1 hour. See [features/threatcon-pir](./threatcon-pir.md).
- **Alert rules** — a rule with `categories: ["cv"]` (and optional `keywords: ["fire"]`) fires immediately. See [features/alert-rules](./alert-rules.md).

## End-to-end timing

1. Camera tile mounts. Detectors `["motion", "fire"]`. Worker spawns. First frame is sampled at ~50 ms after `play()` succeeds.
2. The user walks past the camera. The next 1 Hz sample shows a global RGB delta. `motionScore` returns `0.18`. Cooldown clear.
3. Worker `postMessage({ type: "detection", label: "motion", confidence: 1.0 })`.
4. Tile `onmessage` increments badge counter to 1. POSTs `{ id: "cv-cam_driveway-1735579812345", title: "motion on Driveway", summary: "100% confidence", severity: "moderate", geo: {lat, lon}, payload: {...} }` to `/fabric/api/cv-event`.
5. Fabric stamps `connectorId: "browser-cv"`, persists, broadcasts.
6. Browser's `ws.ts` receives `{type:"event"}` and adds to the store. The IntelFeed shows a new card. Map3D plots a yellow dot at the driveway camera's coordinates.
7. The PIR `cv-alert` flips to `yes`. The TopBar's THREATCON pill ticks up by 0.0 (motion is moderate, no proximity boost).
8. 5 seconds later, the user is gone. Sample returns `motionScore = 0.001` — below threshold. No firing.
9. 7 seconds after the first detection (cooldown expired), if motion resumes, a new `cv-event` fires.

## Limits worth knowing

- **Heuristics, not ML.** The fire detector will fire on a sunset; the edge detector cannot distinguish a person from a parked car.
- **All three "shape" detectors share one cooldown.** Listing both `person` and `vehicle` does not double the firing rate.
- **`payload.label` is fixed by the order in `detectors[]`.** `["vehicle", "person"]` and `["person", "vehicle"]` produce different labels for the same firing.
- **No deduplication on the server side.** A flaky camera that loops the same frame can fire indefinitely until cooldown — fabric will accept and broadcast every one.
- **No CORS handling for `mjpeg` cameras.** The video element has `crossOrigin = "anonymous"` but most internet IP cameras don't return CORS headers, so `ctx.drawImage(v, ...)` taints the canvas and `getImageData` throws. The worker then never receives a frame. RTSP via go2rtc bypasses this because go2rtc serves the WHEP stream from the same origin.
- **One worker per tile** is fine for 4–6 cameras. A wall of 24 tiles will compete with React on the main thread because each `getImageData` decode runs on the main thread, not the worker.

## Related pages

- [apps/web § CameraStrip & CameraTile](../apps/web.md#camerastrip-cameratile) — the host UI.
- [features/alert-rules](./alert-rules.md) — rules against `category: "cv"`.
- [features/threatcon-pir](./threatcon-pir.md) — the `cv-alert` PIR.
- [packages/connectors](../packages/connectors.md) — the CV path is the only "connector" that does not live in `packages/connectors/`.
- [overview/glossary](../overview/glossary.md) — "Detector", "CV event".
