// Shared VLM worker for all camera tiles — model loads once, 3-tier fallback chain.
// When falling back from the preferred tier, a persistent error is pushed to the
// UI so the user knows performance will be degraded.
import { useStore } from "./store";

let _worker: Worker | null = null;
let _status = "idle";
const _detectionHandlers = new Map<string, (msg: any) => void>();
const _statusHandlers = new Set<(s: string) => void>();

const ERROR_KEY = "vlm-model";

function clearVlmError() {
  try {
    useStore.getState().dismissError(ERROR_KEY);
  } catch {
    /* SSR */
  }
}

function reportVlmError(message: string) {
  try {
    useStore.getState().pushError({
      key: ERROR_KEY,
      title: "VLM scene analyzer degraded",
      message,
    });
  } catch {
    /* SSR */
  }
}

function w(): Worker {
  if (_worker) return _worker;
  _worker = new Worker(new URL("../components/visionWorker.ts", import.meta.url), {
    type: "module",
  });
  _worker.onmessage = (ev) => {
    const msg = ev.data;
    if (msg.type === "status") {
      _status = msg.status;
      if (msg.status === "ready" && msg.device) {
        console.info(`[visionEngine] device: ${msg.device}`);
        try {
          useStore.getState().setVlmBackend(msg.device);
        } catch {
          /* SSR */
        }
        if (msg.device === "webgpu") clearVlmError();
      }
      if (msg.status === "fallback" && msg.message) {
        console.warn(`[visionEngine] fallback: ${msg.message}`);
        reportVlmError(msg.message);
      }
      if (msg.status === "error") {
        const err = String(msg.error ?? "Unknown VLM load error");
        console.error(`[visionEngine] load error: ${err}`);
        reportVlmError(err);
      }
      _statusHandlers.forEach((h) => h(_status));
    } else if (msg.type === "detection" && msg.cameraId) {
      _detectionHandlers.get(msg.cameraId)?.(msg);
    } else if (msg.type === "inference-error") {
      console.warn(`[visionEngine] inference error (${msg.cameraId}): ${msg.error}`);
    }
  };
  _worker.onerror = (ev) => {
    const message = `Vision worker crashed: ${ev.message ?? "unknown"} @ ${ev.filename ?? "?"}:${ev.lineno ?? "?"}`;
    console.error(`[visionEngine] ${message}`);
    _status = "error";
    reportVlmError(message);
    _statusHandlers.forEach((h) => h(_status));
  };
  _worker.postMessage({ type: "load" });
  return _worker;
}

export function submitFrame(
  cameraId: string,
  buf: ArrayBuffer,
  width: number,
  height: number,
  detectors: string[] = [],
) {
  w().postMessage({ type: "frame", cameraId, buffer: buf, width, height, detectors }, [buf]);
}

export function onDetection(cameraId: string, handler: (msg: any) => void) {
  w();
  _detectionHandlers.set(cameraId, handler);
  return () => _detectionHandlers.delete(cameraId);
}

export function onModelStatus(handler: (s: string) => void) {
  w();
  _statusHandlers.add(handler);
  handler(_status);
  return () => _statusHandlers.delete(handler);
}
