export type CaptureSource = HTMLVideoElement | HTMLCanvasElement | ImageBitmap;

export type CapturedFrame = {
  buffer: ArrayBuffer;
  width: number;
  height: number;
};

export function isOffscreenCanvasSupported(): boolean {
  return typeof (globalThis as any).OffscreenCanvas !== "undefined";
}

let _offscreen: any = null;
let _offCtx: any = null;
let _domCanvas: HTMLCanvasElement | null = null;
let _domCtx: CanvasRenderingContext2D | null = null;

function getOffscreen(width: number, height: number): {
  canvas: any;
  ctx: any;
} | null {
  if (!isOffscreenCanvasSupported()) return null;
  if (!_offscreen) {
    _offscreen = new (globalThis as any).OffscreenCanvas(width, height);
    _offCtx = _offscreen.getContext("2d", { willReadFrequently: true });
  } else if (_offscreen.width !== width || _offscreen.height !== height) {
    _offscreen.width = width;
    _offscreen.height = height;
  }
  if (!_offCtx) return null;
  return { canvas: _offscreen, ctx: _offCtx };
}

function getDomCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} | null {
  try {
    if (!_domCanvas) {
      _domCanvas = document.createElement("canvas");
      _domCtx = _domCanvas.getContext("2d", { willReadFrequently: true });
    }
    _domCanvas.width = width;
    _domCanvas.height = height;
    if (!_domCtx) return null;
    return { canvas: _domCanvas, ctx: _domCtx };
  } catch {
    return null;
  }
}

export function captureFrameRGBA(
  source: CaptureSource,
  width: number,
  height: number,
): CapturedFrame | null {
  if (width <= 0 || height <= 0) return null;
  const ready = (source as any).readyState;
  if (typeof ready === "number" && ready < 2) return null;

  const offscreen = getOffscreen(width, height);
  if (offscreen) {
    offscreen.ctx.drawImage(source as any, 0, 0, width, height);
    const img = offscreen.ctx.getImageData(0, 0, width, height);
    const data = img.data as Uint8ClampedArray;
    const out = new ArrayBuffer(data.byteLength);
    new Uint8ClampedArray(out).set(data);
    return { buffer: out, width, height };
  }

  const dom = getDomCanvas(width, height);
  if (dom) {
    dom.ctx.drawImage(source as any, 0, 0, width, height);
    const img = dom.ctx.getImageData(0, 0, width, height);
    const data = img.data as Uint8ClampedArray;
    const out = new ArrayBuffer(data.byteLength);
    new Uint8ClampedArray(out).set(data);
    return { buffer: out, width, height };
  }

  return null;
}
