import { describe, it, expect } from "vitest";
import { selectDetectorBackend, type BackendCapabilities } from "./backendSelector";

describe("selectDetectorBackend", () => {
  it("prefers webgpu when supported", () => {
    const caps: BackendCapabilities = { webgpu: true, webgl: true, wasm: true };
    expect(selectDetectorBackend(caps)).toEqual(["webgpu", "webgl", "wasm"]);
  });

  it("falls back to webgl when webgpu unsupported but webgl available", () => {
    const caps: BackendCapabilities = { webgpu: false, webgl: true, wasm: true };
    expect(selectDetectorBackend(caps)).toEqual(["webgl", "wasm"]);
  });

  it("falls back to wasm when only wasm is available", () => {
    const caps: BackendCapabilities = { webgpu: false, webgl: false, wasm: true };
    expect(selectDetectorBackend(caps)).toEqual(["wasm"]);
  });

  it("returns empty array when nothing is available", () => {
    const caps: BackendCapabilities = { webgpu: false, webgl: false, wasm: false };
    expect(selectDetectorBackend(caps)).toEqual([]);
  });

  it("never includes a backend marked false", () => {
    const caps: BackendCapabilities = { webgpu: true, webgl: false, wasm: true };
    const order = selectDetectorBackend(caps);
    expect(order).not.toContain("webgl");
    expect(order).toEqual(["webgpu", "wasm"]);
  });
});
