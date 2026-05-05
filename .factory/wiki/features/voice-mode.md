# Voice mode

A microphone button in the analyst panel turns the LLM into a voice assistant. Speech-to-text uses Whisper-tiny.en running locally via Transformers.js + ONNX Runtime WASM. Text-to-speech uses the browser's built-in `speechSynthesis` API. No audio leaves the device.

## Surface area

| Concern | File |
|---|---|
| Recording, STT, TTS | `apps/web/src/lib/voice.ts` |
| Wiring in chat panel | `apps/web/src/components/AnalystPanel.tsx` (`toggleVoice`, `ttsOn`, `speak()` calls) |
| Pipeline cache | `apps/web/src/lib/ai.ts` (shared `getOrCreatePipeline`) |

## Recording capture

`apps/web/src/lib/voice.ts → startRecording`:

```ts
const stream = await navigator.mediaDevices.getUserMedia({
  audio: { channelCount: 1, sampleRate: 16_000, noiseSuppression: true },
});
const mr = new MediaRecorder(stream, { mimeType: pickMime() });
const chunks: Blob[] = [];
mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
```

The constraints request a mono 16 kHz stream with browser noise suppression. Browsers honour these as a hint; on macOS Chromium the actual sample rate is often 48 kHz regardless. The decode path handles that case (see *Resampling* below).

`pickMime()` walks a preference list:

```ts
function pickMime(): string {
  const c = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  for (const m of c) if (MediaRecorder.isTypeSupported(m)) return m;
  return "audio/webm";
}
```

Opus inside WebM is the universal default. Safari can produce `audio/mp4` but it's not in the list, so Safari falls back to `"audio/webm"` and `MediaRecorder` raises if the browser can't actually encode it. In practice the analyst voice button shows a "voice error" toast on Safari today.

## Two control surfaces

```ts
return {
  abort: () => { aborted = true; mr.stop(); stream.getTracks().forEach((t) => t.stop()); },
  stop: async () => {
    mr.stop();
    stream.getTracks().forEach((t) => t.stop());
    const blob = await done;
    const audio = await blobToFloat32(blob);
    const pipe = await getOrCreatePipeline(
      "automatic-speech-recognition",
      "Xenova/whisper-tiny.en",
      "wasm",
      "q8",
      () => undefined,
    );
    const out = await pipe(audio, { chunk_length_s: 30, stride_length_s: 5 });
    const text = Array.isArray(out) ? out.map((o: any) => o.text).join(" ") : (out as any).text;
    onTranscript(text ?? "");
  },
};
```

`abort()` discards the recording without invoking Whisper. `stop()` runs the full recognition pipeline.

## blobToFloat32 — the decoder + resampler

```ts
async function blobToFloat32(blob: Blob): Promise<Float32Array> {
  const ab = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({
    sampleRate: 16000,
  });
  const decoded = await ctx.decodeAudioData(ab.slice(0));
  const data = decoded.getChannelData(0);
  if (decoded.sampleRate === 16000) return new Float32Array(data);
  const ratio = decoded.sampleRate / 16000;
  const out = new Float32Array(Math.floor(data.length / ratio));
  for (let i = 0; i < out.length; i++) {
    out[i] = data[Math.floor(i * ratio)] ?? 0;
  }
  return out;
}
```

Three steps:

1. **Decode.** A new `AudioContext` is built with `sampleRate: 16000`. Most modern browsers honour this and resample during decode, returning a `Float32` mono buffer at 16 kHz. The `ab.slice(0)` is a defensive copy because `decodeAudioData` detaches the buffer.
2. **Mono mix.** `decoded.getChannelData(0)` takes channel 0. The recorder requested mono via `channelCount: 1`, so this is usually a true mono channel; if a browser insists on stereo, only the left channel is read.
3. **Manual resample.** If the browser ignored the constructor option (looking at you, Safari), the function nearest-neighbour decimates from `decoded.sampleRate` to 16 kHz. This is intentionally crude — Whisper-tiny.en is robust enough that bilinear vs nearest matters less than the recording's noise floor.

## Whisper pipeline

```ts
const pipe = await getOrCreatePipeline(
  "automatic-speech-recognition",
  "Xenova/whisper-tiny.en",
  "wasm",
  "q8",
  () => undefined,
);
const out = await pipe(audio, { chunk_length_s: 30, stride_length_s: 5 });
```

Important details:

- **Hard-coded WASM device.** The rest of the app prefers WebGPU, but voice STT pins to `"wasm"`. The Whisper model's encoder uses ops that the ORT WebGPU EP doesn't support efficiently in older Transformers.js builds, and falling back per-op makes WebGPU slower than pure WASM here.
- **`q8` quantisation** instead of the analyst's `q4`/`q4f16`. Whisper is small enough that 8-bit weights still fit in <40 MB after compression, and the quality drop from q4 was noticeable on short utterances.
- **`chunk_length_s: 30, stride_length_s: 5`** are the standard Whisper streaming windows. Audio longer than 30 s is split into overlapping 30 s chunks with 5 s of overlap, then stitched. Most voice prompts are under 10 s and complete in a single pass.
- The pipeline is cached by the same `(task, model, device, dtype)` key as every other model, so reopening the panel reuses the loaded weights.

## TTS

```ts
let _ttsCancel: (() => void) | null = null;

export async function speak(text: string): Promise<void> {
  cancelSpeak();
  if (typeof speechSynthesis === "undefined") return;
  return new Promise((resolve) => {
    const utter = new SpeechSynthesisUtterance(text.slice(0, 1000));
    utter.rate = 1.05;
    utter.pitch = 1;
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    _ttsCancel = () => { speechSynthesis.cancel(); resolve(); };
    speechSynthesis.speak(utter);
  });
}

export function cancelSpeak() {
  _ttsCancel?.();
  _ttsCancel = null;
}
```

Properties:

- **`text.slice(0, 1000)`** — the browser's speech queue is finite. Truncating prevents very long briefings from filling it.
- **`rate: 1.05`** — slightly faster than default. Subjective; tactical news cadence.
- **`onerror` resolves** the same as `onend` so the analyst's `await speak(...)` never hangs.
- **`cancelSpeak()`** is called at the top of `speak()`, so calling `speak()` repeatedly cuts off the previous utterance. The analyst sends `speak(result)` after every reply; the cancel guarantees only the most recent reply plays.
- **Voice selection is browser default.** No `voice` is set on the utterance, so each browser/OS uses its built-in. There's no user picker.

## Wiring in AnalystPanel

`apps/web/src/components/AnalystPanel.tsx`:

```ts
async function toggleVoice() {
  if (recording) {
    await recRef.current?.stop();
    return;
  }
  try {
    const { startRecording } = await import("@/lib/voice");
    setRecording(true);
    setProgress("Listening…");
    const handle = await startRecording(async (text) => {
      setProgress(null);
      setRecording(false);
      if (text && text.trim()) {
        setInput(text);
        // auto-send after STT.
        setTimeout(() => send(text), 50);
      }
    });
    recRef.current = handle;
  } catch (e: any) {
    setRecording(false);
    setProgress(null);
    setMsgs((arr) => [...arr, { role: "assistant", content: `Voice error: ${e?.message ?? e}` }]);
  }
}
```

The first click starts recording. The second click calls `recRef.current.stop()`, which awaits Whisper, fills the input field with the transcription, and immediately re-invokes `send(text)`. The 50 ms `setTimeout` exists so React can render the input fill before `send` runs.

The TTS toggle is a simple piece of state:

```ts
const [ttsOn, setTtsOn] = useState(false);
// ...
{ttsOn ? <Volume2 /> : <VolumeX />}
```

After every chat reply, the panel checks `ttsOn` and calls `speak(...)`:

```ts
if (ttsOn && result) {
  try {
    const { speak } = await import("@/lib/voice");
    await speak(result.replace(/```[\s\S]*?```/g, ""));
  } catch { /* ignore */ }
}
```

The `replace(/```[\s\S]*?```/g, "")` strips fenced code blocks before speaking. The analyst occasionally inserts a `flyTo` JSON block; the user does not want to hear `"action quote flyTo quote"`.

The same path runs for `runBriefing()`. Note that the briefing skips JSON stripping (its output is structured markdown without code blocks), so the TTS reads the briefing verbatim.

## End-to-end timing

1. User clicks the mic button. `getUserMedia` returns a stream. `MediaRecorder.start()`. Status shows "Listening…".
2. User says "Any earthquakes in Northern California today?"
3. Clicks the mic again. `MediaRecorder.stop()`. The `done` promise resolves with one Blob of Opus-in-WebM.
4. `blobToFloat32` decodes to a `Float32Array` at 16 kHz. ~3 seconds of speech is roughly 48 000 samples.
5. `getOrCreatePipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en", "wasm", "q8")` is cold on first run — downloads the model (~40 MB), then runs the encoder. ~1.5 s on a typical laptop.
6. `pipe(audio, { chunk_length_s: 30, stride_length_s: 5 })` returns `{ text: " Any earthquakes in Northern California today?" }`.
7. `onTranscript(text)` fires inside the `startRecording` handle. The analyst panel sets the input, schedules `send(text)` after 50 ms.
8. `send` runs the standard chat flow. If `ttsOn` is true, the model's reply is then spoken via `speechSynthesis`.

## Limits worth knowing

- **English only.** `Xenova/whisper-tiny.en` is the English-tuned variant. Switching to `whisper-tiny` (multilingual) is a one-line change but quality is worse on short prompts.
- **No streaming STT.** The whole utterance must be recorded and submitted in one shot. There's no partial transcript while the user is still talking.
- **Safari path is brittle.** `pickMime()` doesn't include any of Safari's preferred MIME types; `MediaRecorder` may not even start.
- **The TTS voice is whatever the OS picked.** No accent/gender selection. macOS English defaults to a fairly natural voice; Linux tends to default to espeak.
- **No "wake word" or hands-free loop.** The user has to click mic on, then mic off. There's no VAD-driven auto-stop.
- **Voice button is on the analyst panel only.** The Overseer does not have a voice control surface.

## Related pages

- [features/ai-analyst](./ai-analyst.md) — the chat panel that hosts `toggleVoice` and `ttsOn`.
- [features/briefing-generator](./briefing-generator.md) — uses the same `speak()` for the read-aloud briefing path.
- [overview/fun-facts](../overview/fun-facts.md) — note that voice STT runs on WASM even when WebGPU is available.
