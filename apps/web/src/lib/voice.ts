"use client";
import { getOrCreatePipeline } from "./ai";

export interface RecordingHandle {
  stop: () => Promise<void>;
  abort: () => void;
}

export async function startRecording(
  onTranscript: (text: string) => void,
): Promise<RecordingHandle> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("microphone not available");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, sampleRate: 16_000, noiseSuppression: true },
  });
  const mr = new MediaRecorder(stream, { mimeType: pickMime() });
  const chunks: Blob[] = [];
  mr.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  let aborted = false;
  const done = new Promise<Blob>((resolve, reject) => {
    mr.onstop = () => {
      if (aborted) return reject(new Error("aborted"));
      resolve(new Blob(chunks, { type: mr.mimeType }));
    };
  });
  mr.start();
  return {
    abort: () => {
      aborted = true;
      try {
        mr.stop();
      } catch {
        /* ignore */
      }
      stream.getTracks().forEach((t) => t.stop());
    },
    stop: async () => {
      try {
        mr.stop();
      } catch {
        /* ignore */
      }
      stream.getTracks().forEach((t) => t.stop());
      const blob = await done;
      const audio = await blobToFloat32(blob);
      const pipe = await getOrCreatePipeline(
        "automatic-speech-recognition",
        "Xenova/whisper-tiny.en",
        "fp16",
        () => undefined,
      );
      const out = await pipe(audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      const text = Array.isArray(out) ? out.map((o: any) => o.text).join(" ") : (out as any).text;
      onTranscript(text ?? "");
    },
  };
}

function pickMime(): string {
  const c = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  for (const m of c) if (MediaRecorder.isTypeSupported(m)) return m;
  return "audio/webm";
}

async function blobToFloat32(blob: Blob): Promise<Float32Array> {
  const ab = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({
    sampleRate: 16000,
  });
  try {
    const decoded = await ctx.decodeAudioData(ab.slice(0));
    // mono mix
    const data = decoded.getChannelData(0);
    // Resample if necessary (decodeAudioData honored sampleRate option in most browsers)
    if (decoded.sampleRate === 16000) return new Float32Array(data);
    const ratio = decoded.sampleRate / 16000;
    const out = new Float32Array(Math.floor(data.length / ratio));
    for (let i = 0; i < out.length; i++) {
      out[i] = data[Math.floor(i * ratio)] ?? 0;
    }
    return out;
  } finally {
    ctx.close();
  }
}

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
    _ttsCancel = () => {
      try {
        speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
      resolve();
    };
    speechSynthesis.speak(utter);
  });
}

export function cancelSpeak() {
  _ttsCancel?.();
  _ttsCancel = null;
}
