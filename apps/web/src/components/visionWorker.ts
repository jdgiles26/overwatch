/// <reference lib="webworker" />

// Vision worker — open-vocabulary scene description with a 3-tier backend chain:
//   webgpu → @huggingface/transformers LFM2-VL-450M-ONNX (fp16/q4f16, true VLM)
//   webgl  → @tensorflow-models/mobilenet (ImageNet classification → templated summary)
//   wasm   → @huggingface/transformers LFM2-VL-450M-ONNX (q8 fallback, slow)
//
// When the device falls back from the preferred tier, a status:"fallback" message
// is emitted so the engine can surface a persistent error in the UI.

import {
  formatMobilenetSummary,
  buildVlmFocusHint,
  type MobilenetClassification,
} from "../lib/mobilenetVlmAdapter";

const MODEL_ID = "onnx-community/LFM2-VL-450M-ONNX";

type Backend = "webgpu" | "webgl" | "wasm";

let backend: Backend | null = null;
let processor: any = null;
let model: any = null;
let RawImageCls: any = null;
let mobilenetModel: any = null;
let ready = false;
let loading = false;
let busy = false;

function hasWebGPU(): boolean {
  return (
    typeof (globalThis as any).navigator !== "undefined" &&
    typeof (globalThis as any).navigator.gpu !== "undefined"
  );
}

function hasWebGL(): boolean {
  try {
    const oc: any =
      typeof (globalThis as any).OffscreenCanvas !== "undefined"
        ? new (globalThis as any).OffscreenCanvas(1, 1)
        : null;
    if (!oc) return false;
    const ctx = oc.getContext("webgl2") ?? oc.getContext("webgl");
    return !!ctx;
  } catch {
    return false;
  }
}

async function tryLoadWebGPU(): Promise<boolean> {
  if (!hasWebGPU()) return false;
  try {
    const tf = await import("@huggingface/transformers");
    const { AutoProcessor, AutoModelForImageTextToText, RawImage } = tf as any;
    RawImageCls = RawImage;
    processor = await AutoProcessor.from_pretrained(MODEL_ID);
    model = await AutoModelForImageTextToText.from_pretrained(MODEL_ID, {
      device: "webgpu",
      dtype: {
        embed_tokens: "fp16",
        decoder_model_merged: "q4f16",
        vision_encoder: "fp16",
      },
    });
    backend = "webgpu";
    return true;
  } catch (err) {
    console.warn(`[visionWorker] WebGPU load failed: ${err}`);
    return false;
  }
}

async function tryLoadWebGL(): Promise<boolean> {
  if (!hasWebGL()) return false;
  try {
    const tfjs: any = await import("@tensorflow/tfjs");
    await tfjs.setBackend("webgl");
    await tfjs.ready();
    const mobilenet: any = await import("@tensorflow-models/mobilenet");
    mobilenetModel = await mobilenet.load({ version: 2, alpha: 1.0 });
    backend = "webgl";
    return true;
  } catch (err) {
    console.warn(`[visionWorker] WebGL load failed: ${err}`);
    return false;
  }
}

async function tryLoadWasm(): Promise<boolean> {
  try {
    const tf = await import("@huggingface/transformers");
    const { AutoProcessor, AutoModelForImageTextToText, RawImage } = tf as any;
    RawImageCls = RawImage;
    processor = await AutoProcessor.from_pretrained(MODEL_ID);
    model = await AutoModelForImageTextToText.from_pretrained(MODEL_ID, {
      device: "wasm",
      dtype: {
        embed_tokens: "q8",
        decoder_model_merged: "q8",
        vision_encoder: "q8",
      },
    });
    backend = "wasm";
    return true;
  } catch (err) {
    console.warn(`[visionWorker] WASM load failed: ${err}`);
    return false;
  }
}

async function load() {
  if (ready || loading) return;
  loading = true;
  self.postMessage({ type: "status", status: "loading" });

  try {
    const gpuOk = await tryLoadWebGPU();
    if (gpuOk) {
      loading = false;
      ready = true;
      self.postMessage({ type: "status", status: "ready", device: "webgpu" });
      return;
    }

    // Fallback notification — WebGPU failed
    self.postMessage({
      type: "status",
      status: "fallback",
      message: "WebGPU unavailable for VLM scene analyzer — falling back to WebGL (MobileNet classifier). Captions will be simpler.",
    });

    const glOk = await tryLoadWebGL();
    if (glOk) {
      loading = false;
      ready = true;
      self.postMessage({ type: "status", status: "ready", device: "webgl" });
      return;
    }

    // Fallback notification — WebGL also failed
    self.postMessage({
      type: "status",
      status: "fallback",
      message: "WebGPU & WebGL unavailable for VLM — falling back to slow WASM backend.",
    });

    const wasmOk = await tryLoadWasm();
    loading = false;
    if (!wasmOk || !backend) {
      self.postMessage({
        type: "status",
        status: "error",
        error: "No VLM backend available (webgpu/webgl/wasm all failed)",
      });
      return;
    }

    ready = true;
    self.postMessage({ type: "status", status: "ready", device: "wasm" });
  } catch (err) {
    loading = false;
    self.postMessage({ type: "status", status: "error", error: String(err) });
  }
}

function buildPrompt(detectors: string[]): string {
  const focus = detectors.length > 0 ? `Pay special attention to: ${detectors.join(", ")}.` : "";
  return (
    `You are a security camera analyst. ${focus} ` +
    "Describe what you observe in one concise sentence. " +
    "Be specific — name what you actually see, not generic categories. " +
    "If the scene is empty or static, respond with exactly: No activity."
  );
}

async function runTransformersVlm(
  arr: Uint8ClampedArray,
  width: number,
  height: number,
  detectors: string[],
): Promise<string> {
  const image = new RawImageCls(arr, width, height, 4);
  const messages = [
    {
      role: "user",
      content: [{ type: "image" }, { type: "text", text: buildPrompt(detectors) }],
    },
  ];
  const prompt = processor.apply_chat_template(messages, { add_generation_prompt: true });
  const inputs = await processor(image, prompt, { add_special_tokens: false });
  const outputs = await model.generate({ ...inputs, max_new_tokens: 128 });
  const inputLen = inputs.input_ids.dims.at(-1) as number;
  const decoded: string[] = processor.batch_decode(
    outputs.slice(null, [inputLen, null]),
    { skip_special_tokens: true },
  );
  return (decoded[0] ?? "").trim();
}

async function runMobilenetVlm(
  arr: Uint8ClampedArray,
  width: number,
  height: number,
  detectors: string[],
): Promise<string> {
  const oc = new (globalThis as any).OffscreenCanvas(width, height);
  const ctx: any = oc.getContext("2d");
  if (!ctx) throw new Error("Cannot get 2d context for MobileNet frame");
  const img = ctx.createImageData(width, height);
  img.data.set(arr);
  ctx.putImageData(img, 0, 0);
  const raw = await mobilenetModel.classify(oc, 5);
  const preds: MobilenetClassification[] = (raw as any[]).map((p) => ({
    className: String(p.className ?? p.class ?? ""),
    probability: Number(p.probability ?? p.score ?? 0),
  }));
  const scene = formatMobilenetSummary(preds);
  const hint = buildVlmFocusHint(detectors);
  return hint ? `${scene} ${hint}`.trim() : scene;
}

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data;

  if (msg.type === "load") {
    load();
    return;
  }

  if (msg.type !== "frame" || !ready || busy) return;

  busy = true;
  try {
    const arr = new Uint8ClampedArray(msg.buffer);
    const detectors: string[] = msg.detectors ?? [];

    const summary =
      backend === "webgl"
        ? await runMobilenetVlm(arr, msg.width, msg.height, detectors)
        : await runTransformersVlm(arr, msg.width, msg.height, detectors);

    self.postMessage({ type: "detection", cameraId: msg.cameraId, summary });
  } catch (err) {
    self.postMessage({ type: "inference-error", cameraId: msg.cameraId, error: String(err) });
  } finally {
    busy = false;
  }
};

export {};
