import { describe, it, expect, vi, beforeEach } from "vitest";

const drawImageMock = vi.fn();
const getImageDataMock = vi.fn();

class FakeOffscreenCanvas {
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  getContext(kind: string) {
    if (kind !== "2d") return null;
    return {
      drawImage: drawImageMock,
      getImageData: getImageDataMock,
    };
  }
}

(globalThis as any).OffscreenCanvas = FakeOffscreenCanvas;

import {
  captureFrameRGBA,
  isOffscreenCanvasSupported,
  type CaptureSource,
} from "./frameCapture";

beforeEach(() => {
  drawImageMock.mockReset();
  getImageDataMock.mockReset();
  getImageDataMock.mockReturnValue({
    data: new Uint8ClampedArray(320 * 180 * 4),
    width: 320,
    height: 180,
  });
});

describe("isOffscreenCanvasSupported", () => {
  it("returns true when OffscreenCanvas is on globalThis", () => {
    expect(isOffscreenCanvasSupported()).toBe(true);
  });
});

describe("captureFrameRGBA", () => {
  it("draws the source onto an OffscreenCanvas of the requested size", () => {
    const fakeVideo = { readyState: 4 } as unknown as CaptureSource;
    captureFrameRGBA(fakeVideo, 320, 180);
    expect(drawImageMock).toHaveBeenCalledTimes(1);
    expect(drawImageMock).toHaveBeenCalledWith(fakeVideo, 0, 0, 320, 180);
  });

  it("returns an ArrayBuffer of the expected size (width*height*4)", () => {
    const fakeVideo = { readyState: 4 } as unknown as CaptureSource;
    const result = captureFrameRGBA(fakeVideo, 320, 180);
    expect(result).not.toBeNull();
    expect(result!.width).toBe(320);
    expect(result!.height).toBe(180);
    expect(result!.buffer.byteLength).toBe(320 * 180 * 4);
  });

  it("returns null when source video is not ready", () => {
    const notReady = { readyState: 0 } as unknown as CaptureSource;
    expect(captureFrameRGBA(notReady, 320, 180)).toBeNull();
    expect(drawImageMock).not.toHaveBeenCalled();
  });

  it("returns null when dimensions are zero", () => {
    const fakeVideo = { readyState: 4 } as unknown as CaptureSource;
    expect(captureFrameRGBA(fakeVideo, 0, 180)).toBeNull();
    expect(captureFrameRGBA(fakeVideo, 320, 0)).toBeNull();
  });
});
