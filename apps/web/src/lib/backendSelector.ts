export type DetectorBackend = "webgpu" | "webgl" | "wasm";

export type BackendCapabilities = {
  webgpu: boolean;
  webgl: boolean;
  wasm: boolean;
};

const PRIORITY: DetectorBackend[] = ["webgpu", "webgl", "wasm"];

export function selectDetectorBackend(
  caps: BackendCapabilities,
): DetectorBackend[] {
  return PRIORITY.filter((b) => caps[b]);
}

export function detectBackendCapabilities(): BackendCapabilities {
  const nav: any = typeof globalThis !== "undefined"
    ? (globalThis as any).navigator
    : undefined;
  const hasWebGPU = !!nav && typeof nav.gpu !== "undefined";
  let hasWebGL = false;
  try {
    const oc: any =
      typeof (globalThis as any).OffscreenCanvas !== "undefined"
        ? new (globalThis as any).OffscreenCanvas(1, 1)
        : null;
    if (oc) {
      const ctx = oc.getContext("webgl2") ?? oc.getContext("webgl");
      hasWebGL = !!ctx;
    }
  } catch {
    hasWebGL = false;
  }
  return { webgpu: hasWebGPU, webgl: hasWebGL, wasm: true };
}
