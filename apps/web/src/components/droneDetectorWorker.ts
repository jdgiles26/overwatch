/// <reference lib="webworker" />

import { droneDetectorModelId } from "../lib/detectionConfig";
import {
  parseDetections,
  type ParsedDetection,
  type DroneCvEvent,
  buildDroneCvEvent,
} from "../lib/droneDetectorEngine";

let detector: any = null;
let ready = false;
let loading = false;
let busy = false;

async function load() {
  if (ready || loading) return;
  loading = true;
  self.postMessage({ type: "status", status: "loading" });

  try {
    const tf = await import("@huggingface/transformers");
    const { pipeline } = tf as any;

    const hasWebGPU =
      typeof (globalThis as any).navigator !== "undefined" &&
      typeof (globalThis as any).navigator.gpu !== "undefined";

    let currentDevice: "webgpu" | "wasm" | null = null;

    if (hasWebGPU) {
      try {
        detector = await pipeline("object-detection", droneDetectorModelId, {
          device: "webgpu",
          dtype: "fp16",
        });
        currentDevice = "webgpu";
      } catch (webgpuErr) {
        console.warn(
          `[droneDetectorWorker] WebGPU load failed, falling back to WASM: ${webgpuErr}`,
        );
      }
    }

    if (!currentDevice) {
      detector = await pipeline("object-detection", droneDetectorModelId, {
        device: "wasm",
        dtype: "q8",
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

    const tf = await import("@huggingface/transformers");
    const { RawImage } = tf as any;

    const image = new RawImage(arr, width, height, 4);

    const rawDetections = await detector(image, {
      threshold: minScore,
      percentage: false,
    });

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
