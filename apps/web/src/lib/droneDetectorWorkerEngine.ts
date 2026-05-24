// Shared DETR drone-detector worker for all camera tiles — 3-tier fallback chain.
// When falling back from the preferred tier, a persistent error is pushed to the
// UI so the user knows performance will be degraded.
import { useStore } from "./store";

let _worker: Worker | null = null;
let _status = "idle";
const _detectionHandlers = new Map<string, (msg: any) => void>();
const _statusHandlers = new Set<(s: string) => void>();

const ERROR_KEY = "drone-detector-model";

function clearDetectorError() {
  try {
    useStore.getState().dismissError(ERROR_KEY);
  } catch {
    /* SSR */
  }
}

function reportDetectorError(message: string) {
  try {
    useStore.getState().pushError({
      key: ERROR_KEY,
      title: "Drone object detector degraded",
      message,
    });
  } catch {
    /* SSR */
  }
}

function w(): Worker {
  if (_worker) return _worker;
  _worker = new Worker(
    new URL("../components/droneDetectorWorker.ts", import.meta.url),
    { type: "module" },
  );
  _worker.onmessage = (ev) => {
    const msg = ev.data;
    if (msg.type === "status") {
      _status = msg.status;
      if (msg.status === "ready" && msg.device) {
        console.info(`[droneDetector] device: ${msg.device}`);
        try {
          useStore.getState().setYoloBackend(msg.device);
        } catch {
          /* SSR */
        }
        if (msg.device === "webgpu") clearDetectorError();
      }
      if (msg.status === "fallback" && msg.message) {
        console.warn(`[droneDetector] fallback: ${msg.message}`);
        reportDetectorError(msg.message);
      }
      if (msg.status === "error") {
        const err = String(msg.error ?? "Unknown drone-detector load error");
        console.error(`[droneDetector] load error: ${err}`);
        reportDetectorError(err);
      }
      _statusHandlers.forEach((h) => h(_status));
    } else if (msg.type === "detection" && msg.cameraId) {
      _detectionHandlers.get(msg.cameraId)?.(msg);
    } else if (msg.type === "inference-error") {
      console.warn(`[droneDetector] inference error (${msg.cameraId}): ${msg.error}`);
    }
  };
  _worker.onerror = (ev) => {
    const message = `Drone-detector worker crashed: ${ev.message ?? "unknown"} @ ${ev.filename ?? "?"}:${ev.lineno ?? "?"}`;
    console.error(`[droneDetector] ${message}`);
    _status = "error";
    reportDetectorError(message);
    _statusHandlers.forEach((h) => h(_status));
  };
  _worker.postMessage({ type: "load" });
  return _worker;
}

export function submitDroneFrame(
  cameraId: string,
  buf: ArrayBuffer,
  width: number,
  height: number,
  geo?: { lat: number; lon: number },
  minScore = 0.3,
) {
  w().postMessage(
    { type: "frame", cameraId, buffer: buf, width, height, geo, minScore },
    [buf],
  );
}

export function onDroneDetection(cameraId: string, handler: (msg: any) => void) {
  w();
  _detectionHandlers.set(cameraId, handler);
  return () => _detectionHandlers.delete(cameraId);
}

export function onDroneDetectorStatus(handler: (s: string) => void) {
  w();
  _statusHandlers.add(handler);
  handler(_status);
  return () => _statusHandlers.delete(handler);
}
