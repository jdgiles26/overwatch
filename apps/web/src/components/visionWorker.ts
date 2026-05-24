/// <reference lib="webworker" />

// Vision worker — LiquidAI LFM2-VL-450M-ONNX (open-vocabulary VLM)
// Uses WebGPU with fp16/q4f16 dtypes; falls back to WASM with q8 dtypes.
// Receives raw RGBA frames + per-camera watch descriptors, returns a free-text
// scene description. No fixed label set — the model describes whatever it sees.

const MODEL_ID = "onnx-community/LFM2-VL-450M-ONNX";

let processor: any = null;
let model: any = null;
let RawImageCls: any = null;
let ready = false;
let loading = false;
let busy = false;
let currentDevice: string | null = null;

async function load() {
  if (ready || loading) return;
  loading = true;
  self.postMessage({ type: "status", status: "loading" });

  try {
    const tf = await import("@huggingface/transformers");
    const { AutoProcessor, AutoModelForImageTextToText, RawImage } = tf as any;
    RawImageCls = RawImage;

    processor = await AutoProcessor.from_pretrained(MODEL_ID);

    const hasWebGPU =
      typeof (globalThis as any).navigator !== "undefined" &&
      typeof (globalThis as any).navigator.gpu !== "undefined";

    let loaded = false;

    if (hasWebGPU) {
      try {
        model = await AutoModelForImageTextToText.from_pretrained(MODEL_ID, {
          device: "webgpu",
          dtype: {
            embed_tokens: "fp16",
            decoder_model_merged: "q4f16",
            vision_encoder: "fp16",
          },
        });
        currentDevice = "webgpu";
        loaded = true;
      } catch (webgpuErr) {
        console.warn(`[visionWorker] WebGPU load failed, falling back to WASM: ${webgpuErr}`);
      }
    }

    if (!loaded) {
      model = await AutoModelForImageTextToText.from_pretrained(MODEL_ID, {
        device: "wasm",
        dtype: {
          embed_tokens: "q8",
          decoder_model_merged: "q8",
          vision_encoder: "q8",
        },
      });
      currentDevice = "wasm";
    }

    loading = false;
    ready = true;
    self.postMessage({ type: "status", status: "ready", device: currentDevice });
  } catch (err) {
    loading = false;
    self.postMessage({ type: "status", status: "error", error: String(err) });
  }
}

function buildPrompt(detectors: string[]): string {
  const focus =
    detectors.length > 0
      ? `Pay special attention to: ${detectors.join(", ")}.`
      : "";
  return (
    `You are a security camera analyst. ${focus} ` +
    "Describe what you observe in one concise sentence. " +
    "Be specific — name what you actually see, not generic categories. " +
    "If the scene is empty or static, respond with exactly: No activity."
  );
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
    const image = new RawImageCls(arr, msg.width, msg.height, 4);
    const detectors: string[] = msg.detectors ?? [];

    const messages = [
      {
        role: "user",
        content: [
          { type: "image" },
          { type: "text", text: buildPrompt(detectors) },
        ],
      },
    ];

    const prompt = processor.apply_chat_template(messages, { add_generation_prompt: true });
    const inputs = await processor(image, prompt, { add_special_tokens: false });

    const outputs = await model.generate({
      ...inputs,
      max_new_tokens: 128,
    });

    const inputLen = inputs.input_ids.dims.at(-1) as number;
    const decoded: string[] = processor.batch_decode(
      outputs.slice(null, [inputLen, null]),
      { skip_special_tokens: true },
    );

    const summary = (decoded[0] ?? "").trim();

    self.postMessage({ type: "detection", cameraId: msg.cameraId, summary });
  } catch (err) {
    self.postMessage({ type: "inference-error", cameraId: msg.cameraId, error: String(err) });
  } finally {
    busy = false;
  }
};

export {};
