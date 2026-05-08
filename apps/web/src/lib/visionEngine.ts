// One shared detection worker for all camera tiles — model loads once and stays in memory.

let _worker: Worker | null = null;
let _status = "idle";
const _detectionHandlers = new Map<string, (msg: any) => void>();
const _statusHandlers = new Set<(s: string) => void>();

function w(): Worker {
  if (_worker) return _worker;
  _worker = new Worker(new URL("../components/visionWorker.ts", import.meta.url), {
    type: "module",
  });
  _worker.onmessage = (ev) => {
    const msg = ev.data;
    if (msg.type === "status") {
      _status = msg.status;
      if (msg.device) console.info(`[visionEngine] device: ${msg.device}`);
      if (msg.error) console.error(`[visionEngine] load error: ${msg.error}`);
      _statusHandlers.forEach((h) => h(_status));
    } else if (msg.type === "detection" && msg.cameraId) {
      _detectionHandlers.get(msg.cameraId)?.(msg);
    } else if (msg.type === "inference-error") {
      console.warn(`[visionEngine] inference error (${msg.cameraId}): ${msg.error}`);
    }
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
