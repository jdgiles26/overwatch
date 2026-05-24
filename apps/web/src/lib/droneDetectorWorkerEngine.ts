// Singleton engine for the YOLO drone detector Web Worker.
// Mirrors the pattern in visionEngine.ts — one shared worker for all camera tiles.

let _worker: Worker | null = null;
let _status = "idle";
const _detectionHandlers = new Map<string, (msg: any) => void>();
const _statusHandlers = new Set<(s: string) => void>();

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
      if (msg.device) console.info(`[droneDetector] device: ${msg.device}`);
      if (msg.error) console.error(`[droneDetector] load error: ${msg.error}`);
      _statusHandlers.forEach((h) => h(_status));
    } else if (msg.type === "detection" && msg.cameraId) {
      _detectionHandlers.get(msg.cameraId)?.(msg);
    } else if (msg.type === "inference-error") {
      console.warn(
        `[droneDetector] inference error (${msg.cameraId}): ${msg.error}`,
      );
    }
  };
  _worker.onerror = (ev) => {
    console.error(
      `[droneDetector] worker error: ${ev.message ?? "unknown"} @ ${ev.filename ?? "?"}:${ev.lineno ?? "?"}`,
    );
    _status = "error";
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

export function onDroneDetection(
  cameraId: string,
  handler: (msg: any) => void,
) {
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
