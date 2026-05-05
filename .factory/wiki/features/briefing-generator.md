# Briefing generator

A one-button operation that pulls a structured snapshot from the fabric, hands it to the in-browser LLM with a tight 5-section system prompt, streams the response into the analyst transcript, and optionally reads it aloud. The output is markdown with fixed section headings.

## Surface area

| Concern | File |
|---|---|
| Server-side context | `apps/fabric/src/index.ts` (`GET /api/briefing-context`) |
| Browser entry point | `apps/web/src/components/AnalystPanel.tsx` (`runBriefing`) |
| LLM driver | `apps/web/src/lib/ai.ts` (`runChat`) |
| TTS hook | `apps/web/src/lib/voice.ts` (`speak`) |

## The briefing context endpoint

`apps/fabric/src/index.ts → GET /api/briefing-context`:

```ts
app.get("/api/briefing-context", async () => {
  const events = recentEvents(120);
  const locations = listLocations().map((l: any) => ({
    id: l.id, label: l.label, geo: { lat: l.lat, lon: l.lon },
    radiusKm: l.radius_km, kind: l.kind,
  }));
  const tc = computeThreatcon(events, locations);
  const pir = computePIR(events, locations);
  const sevRank: Record<string, number> = { extreme: 4, high: 3, moderate: 2, low: 1, info: 0 };
  const top = [...events]
    .sort((a, b) => (sevRank[b.severity] ?? 0) - (sevRank[a.severity] ?? 0))
    .slice(0, 30)
    .map((e) => ({
      id: e.id,
      cat: e.category,
      sev: e.severity,
      title: e.title,
      where: e.geo ? [Number(e.geo.lat.toFixed(2)), Number(e.geo.lon.toFixed(2))] : null,
      when: e.occurredAt,
      src: e.source,
    }));
  const counts: Record<string, number> = {};
  for (const e of events) counts[e.category] = (counts[e.category] ?? 0) + 1;
  return { threatcon: tc, pir, counts, top };
});
```

Properties:

- **Source data is the most-recent 120 events.** Smaller than the THREATCON loop's 1000 because the briefing only needs a representative slice.
- **THREATCON and PIR are computed fresh.** This endpoint does not just return the cached version from the WebSocket loop; it recomputes both. So the briefing is consistent with itself even if the 15 s tick hasn't fired in the last 14 seconds.
- **`top` is the 30 highest-severity events, sorted by severity rank.** Ties are broken by store order (most recent first because `events` arrive in reverse-chronological order from `recentEvents`).
- **Geo is rounded to 2 decimal places.** The model doesn't need 6 decimals of lat/lon, and the prompt size matters.
- **`counts` is per-`EventCategory`** across all 120 events.
- **No deduplication.** If the same event is in `top` and is also driving a THREATCON `reason`, it appears in both.

The endpoint has no query parameters and no caching layer. Each call rereads the events table.

## The briefing prompt

`apps/web/src/components/AnalystPanel.tsx → runBriefing`:

```ts
async function runBriefing() {
  if (busy) return;
  setBusy(true);
  setMsgs((m) => [...m, { role: "user", content: "Generate a tactical situational briefing." }]);
  try {
    const ctx = await apiGet<any>("/api/briefing-context");
    const sys = `You are OverWatch Analyst preparing a 5-section tactical briefing.
Output structured markdown with sections:
1. EXECUTIVE SUMMARY (2 sentences)
2. THREATCON (one line: score + main drivers)
3. PRIORITY EVENTS (3 bullets, each with severity, where, why)
4. PIR ANSWERS (one bullet per PIR)
5. RECOMMENDED ACTIONS (3 short bullets)
Be precise. Cite event titles. No filler.`;
    const user = `LIVE INTEL:\n${JSON.stringify(ctx, null, 2)}`;
    const { runChat } = await import("@/lib/ai");
    let out = "";
    const handle = await runChat({
      model,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      maxNewTokens: 360,
      temperature: 0.3,
      onProgress: setProgress,
      onDevice: setDevice,
      onToken: (t) => {
        out += t;
        setMsgs(/* ... append streaming chunk ... */);
      },
    });
    stopRef.current = handle;
    const final = (await handle.done) || out;
    setMsgs(/* ... finalize last assistant message ... */);
    if (ttsOn) {
      try {
        const { speak } = await import("@/lib/voice");
        await speak(final);
      } catch (e) { /* tts optional */ }
    }
  } catch (e: any) {
    setMsgs((arr) => [...arr, { role: "assistant", content: `Briefing failed: ${e.message ?? e}` }]);
  } finally {
    setBusy(false);
    setProgress(null);
    stopRef.current = null;
  }
}
```

Key knobs:

- **`maxNewTokens: 360`** — long enough for a complete 5-section briefing on SmolLM2-360M. The chat path uses 256.
- **`temperature: 0.3`** — lower than the 0.5 chat default. Keeps the structured headings stable.
- **The system prompt is 7 lines.** It states the role, declares the 5 sections, and ends with `"Be precise. Cite event titles. No filler."` SmolLM2 follows the structure reliably; Llama-3.2-1B follows it more reliably and produces longer bullets.
- **The user message is `LIVE INTEL:` followed by the full JSON of the briefing context.** No selective formatting — the model gets the structured data verbatim.
- **The same `model` state used for the chat is reused.** A user who has switched to Llama-3.2-1B for chat will get briefings from Llama-3.2-1B too.

## The streaming protocol

The briefing uses the same `onToken` streaming as the chat path. On the first token, it appends a new assistant message to the transcript with `streaming: true`. On every subsequent token, it overwrites that message's content with the accumulated buffer. On `await handle.done`, it strips the `streaming` flag and replaces the content with `final`.

The `(await handle.done) || out` fallback covers the case where `done` resolves with an empty string (some pipelines do this when generation is interrupted) — the accumulated `out` is preferred over an empty result.

## TTS path

If `ttsOn` is enabled in the analyst panel, the final markdown is passed to `speak()`:

```ts
if (ttsOn) {
  try {
    const { speak } = await import("@/lib/voice");
    await speak(final);
  } catch (e) { /* tts optional */ }
}
```

Unlike the chat path, the briefing TTS does **not** strip code blocks — the briefing prompt produces clean markdown without fences, so there's nothing to strip. The `speak()` function truncates at 1000 characters (`apps/web/src/lib/voice.ts`), which is roughly 200 spoken words. Long briefings are cut off mid-bullet.

## UI exposure

The "Generate briefing" button is in the analyst panel's quick-action row, with `data-agent="analyst-briefing"` so the Overseer can press it:

```tsx
<button
  onClick={runBriefing}
  disabled={busy}
  className="rounded-full border border-accent-500/40 bg-accent-500/15 px-2 py-0.5 text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
  data-agent="analyst-briefing"
>
  <ClipboardList className="mr-1 inline h-3 w-3" />
  Generate briefing
</button>
```

The button is disabled while `busy` is true (during any chat or briefing generation). Clicking it appends a `{role: "user", content: "Generate a tactical situational briefing."}` line to the transcript so the user can see the request in their chat history alongside spontaneous prompts.

## End-to-end timing

1. User clicks **Generate briefing** in the analyst panel.
2. `setMsgs` appends a user line `"Generate a tactical situational briefing."`.
3. `apiGet("/api/briefing-context")` round-trips `~5 ms` on a local fabric.
4. Fabric reads `recentEvents(120)`, computes THREATCON, computes PIR, sorts top-30 by severity, builds counts. Returns ~3–8 KB of JSON.
5. Browser composes `messages = [{role:"system", content: sys}, {role:"user", content: "LIVE INTEL:\n" + JSON}]`.
6. `runChat({ model, messages, maxNewTokens: 360, temperature: 0.3, onToken })` — first token appears in ~1 second on WebGPU after the model is warm.
7. Token stream renders into the transcript. Typical briefing is ~250 tokens, so ~3 seconds of streaming.
8. `await handle.done` resolves with the full markdown text. The transcript is finalised.
9. If `ttsOn`, `speak(final)` is called. The browser's `speechSynthesis` reads up to 1000 characters at rate 1.05.

## Sample output (SmolLM2-360M, light-traffic demo data)

```
1. EXECUTIVE SUMMARY: Three live alerts. THREATCON 3.4 (guarded), driven by a moderate
   air-quality event near SF HQ and a M4.2 quake offshore.
2. THREATCON: 3.4 guarded — main drivers: M4.2 quake (180km off Vallejo), AQI moderate near SF HQ.
3. PRIORITY EVENTS:
   - HIGH M4.2 quake (180km W of Vallejo)
   - MODERATE AQI 38 PM2.5 (SF HQ)
   - INFO 137 active flights in CONUS bbox
4. PIR ANSWERS:
   - Severe weather within 25 miles? no
   - Earthquake M4+ within 200 km in the last 24h? yes
   - Active wildfire within 100 km? no
   - Poor air quality (PM2.5>35) near a location? yes
   - IoT anomaly flagged in the last hour? no
   - Computer-vision detector fired in the last hour? no
5. RECOMMENDED ACTIONS:
   - Monitor aftershock activity offshore.
   - Limit outdoor exertion at SF HQ.
   - No further action needed for transport feed.
```

## Limits worth knowing

- **The format is enforced by the prompt, not by the model.** A fast 360M model will sometimes drop a section or merge two. Switching to Llama-3.2-1B improves structure compliance at the cost of a much heavier first-load.
- **There is no diff or "what changed" mode.** The briefing is always a fresh snapshot.
- **No history persisted server-side.** The briefing is not saved anywhere — it lives only in the analyst transcript.
- **`/api/briefing-context` is anonymous and unrate-limited.** Anything that can reach `:4311` can scrape the structured snapshot.
- **The 30-event cap on `top` is hard-coded.** A high-traffic deployment with 100+ extreme events all in the last hour would still see only the 30 most severe.
- **No follow-up turn.** "Drill into priority event #2" is a separate chat prompt against the same context, not a structured continuation.

## Related pages

- [features/ai-analyst](./ai-analyst.md) — the chat panel that hosts this button.
- [features/threatcon-pir](./threatcon-pir.md) — the algorithms whose output is embedded in the briefing context.
- [features/voice-mode](./voice-mode.md) — the optional TTS playback path.
- [apps/fabric](../apps/fabric.md) — the `briefing-context` REST surface.
