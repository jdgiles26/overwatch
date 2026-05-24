/// <reference lib="webworker" />

// Drone detector worker — DETR-ResNet-50 (COCO) with a 3-tier backend chain:
//   webgpu → Transformers.js DETR (fp16, fastest)
//   webgl  → TF.js + coco-ssd@lite_mobilenet_v2 (WebGL accelerated)
//   wasm   → Transformers.js DETR (q8, slow but universal)
//
// When the device falls back from the preferred tier, a status:"fallback" message
// is emitted so the engine can surface a persistent error in the UI.

import { droneDetectorModelId } from "../lib/detectionConfig";
import {
  parseDetections,
  type ParsedDetection,
  type DroneCvEvent,
  buildDroneCvEvent,
  type DetectorRawOutput,
} from "../lib/droneDetectorEngine";
import { cocoSsdToDetectorRaw } from "../lib/cocoSsdAdapter";

type Backend = "webgpu" | "webgl" | "wasm";

let backend: Backend | null = null;
let transformersDetector: any = null;
let cocoSsdModel: any = null;
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
    const { pipeline } = tf as any;
    transformersDetector = await pipeline("object-detection", droneDetectorModelId, {
      device: "webgpu",
      dtype: "fp16",
    });
    backend = "webgpu";
    return true;
  } catch (err) {
    console.warn(`[droneDetectorWorker] WebGPU load failed: ${err}`);
    return false;
  }
}

async function tryLoadWebGL(): Promise<boolean> {
  if (!hasWebGL()) return false;
  try {
    const tfjs: any = await import("@tensorflow/tfjs");
    await tfjs.setBackend("webgl");
    await tfjs.ready();
    const cocoSsd: any = await import("@tensorflow-models/coco-ssd");
    cocoSsdModel = await cocoSsd.load({ base: "lite_mobilenet_v2" });
    backend = "webgl";
    return true;
  } catch (err) {
    console.warn(`[droneDetectorWorker] WebGL load failed: ${err}`);
    return false;
  }
}

async function tryLoadWasm(): Promise<boolean> {
  try {
    const tf = await import("@huggingface/transformers");
    const { pipeline } = tf as any;
    transformersDetector = await pipeline("object-detection", droneDetectorModelId, {
      device: "wasm",
      dtype: "q8",
    });
    backend = "wasm";
    return true;
  } catch (err) {
    console.warn(`[droneDetectorWorker] WASM load failed: ${err}`);
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

    self.postMessage({
      type: "status",
      status: "fallback",
      message: "WebGPU unavailable for drone detector — falling back to WebGL (TF.js coco-ssd).",
    });

    const glOk = await tryLoadWebGL();
    if (glOk) {
      loading = false;
      ready = true;
      self.postMessage({ type: "status", status: "ready", device: "webgl" });
      return;
    }

    self.postMessage({
      type: "status",
      status: "fallback",
      message: "WebGPU & WebGL unavailable for drone detector — falling back to slow WASM backend.",
    });

    const wasmOk = await tryLoadWasm();
    loading = false;
    if (!wasmOk || !backend) {
      self.postMessage({
        type: "status",
        status: "error",
        error: "No detection backend available (webgpu/webgl/wasm all failed)",
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

async function runTransformers(
  arr: Uint8ClampedArray,
  width: number,
  height: number,
  minScore: number,
): Promise<DetectorRawOutput[]> {
  const tf = await import("@huggingface/transformers");
  const { RawImage } = tf as any;
  const image = new RawImage(arr, width, height, 4);
  const raw = await transformersDetector(image, { threshold: minScore, percentage: false });
  return raw as DetectorRawOutput[];
}

async function runCocoSsd(
  arr: Uint8ClampedArray,
  width: number,
  height: number,
  minScore: number,
): Promise<DetectorRawOutput[]> {
  const oc = new (globalThis as any).OffscreenCanvas(width, height);
  const ctx: any = oc.getContext("2d");
  if (!ctx) throw new Error("Cannot get 2d context for coco-ssd frame");
  const img = ctx.createImageData(width, height);
  img.data.set(arr);
  ctx.putImageData(img, 0, 0);
  const preds = await cocoSsdModel.detect(oc, 20, minScore);
  return cocoSsdToDetectorRaw(preds);
}

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data;

  if (msg.type === "load") {
    load();
    return;
  }

  if (msg.type !== "frame" || !ready || busy) return;

  busy = true;
  const t0 = performance.now();

  try {
    const arr = new Uint8ClampedArray(msg.buffer);
    const width: number = msg.width;
    const height: number = msg.height;
    const cameraId: string = msg.cameraId;
    const geo: { lat: number; lon: number } | undefined = msg.geo;
    const minScore: number = msg.minScore ?? 0.3;

    const rawDetections =
      backend === "webgl"
        ? await runCocoSsd(arr, width, height, minScore)
        : await runTransformers(arr, width, height, minScore);

    const inferenceMs = performance.now() - t0;
    const parsed: ParsedDetection[] = parseDetections(rawDetections, minScore);
    const event: DroneCvEvent = buildDroneCvEvent(cameraId, parsed, geo, inferenceMs);

    self.postMessage({ type: "detection", ...event });
  } catch (err) {
    self.postMessage({
      type: "inference-error",
      cameraId: msg.cameraId,
      error: String(err),
    });
  } finally {
    busy = false;
  }
};

export {};
