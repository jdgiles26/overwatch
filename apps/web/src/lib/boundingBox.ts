export type AbsoluteBox = {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
};

export type PercentBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function normalizeBoxToPercent(
  box: AbsoluteBox,
  frameWidth: number,
  frameHeight: number,
): PercentBox {
  if (frameWidth <= 0 || frameHeight <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  const xmin = Math.max(0, Math.min(box.xmin, frameWidth));
  const xmax = Math.max(0, Math.min(box.xmax, frameWidth));
  const ymin = Math.max(0, Math.min(box.ymin, frameHeight));
  const ymax = Math.max(0, Math.min(box.ymax, frameHeight));
  const left = (xmin / frameWidth) * 100;
  const top = (ymin / frameHeight) * 100;
  const width = ((xmax - xmin) / frameWidth) * 100;
  const height = ((ymax - ymin) / frameHeight) * 100;
  return { left, top, width, height };
}

const DRONE_LIKE_COLOR = "#ff3b3b";
const DEFAULT_COLOR = "#22d3ee";

export function severityColorForLabel(_label: string, isDroneLike: boolean): string {
  return isDroneLike ? DRONE_LIKE_COLOR : DEFAULT_COLOR;
}

export function isDrawableBox(box: PercentBox): boolean {
  return box.width >= 0.5 && box.height >= 0.5;
}
