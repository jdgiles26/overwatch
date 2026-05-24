"use client";
import { useStore } from "@/lib/store";
import {
  normalizeBoxToPercent,
  severityColorForLabel,
  isDrawableBox,
} from "@/lib/boundingBox";

const FRAME_W = 320;
const FRAME_H = 180;
const EMPTY: CvDetection[] = [];

import type { CvDetection } from "@overwatch/schemas";

export function BoundingBoxOverlay({ cameraId }: { cameraId: string }) {
  const detections = useStore((s) => s.yoloDetections[cameraId] ?? EMPTY);
  if (detections.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <filter id={`glow-${cameraId}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {detections.map((d, i) => {
        const pct = normalizeBoxToPercent(d.box, FRAME_W, FRAME_H);
        if (!isDrawableBox(pct)) return null;
        const color = severityColorForLabel(d.label, d.isDroneLike);
        const key = `${cameraId}-${i}-${d.label}`;
        return (
          <g key={key} filter={`url(#glow-${cameraId})`}>
            <rect
              x={pct.left}
              y={pct.top}
              width={pct.width}
              height={pct.height}
              fill="none"
              stroke={color}
              strokeWidth={0.6}
              vectorEffect="non-scaling-stroke"
            />
            <rect
              x={pct.left}
              y={Math.max(0, pct.top - 4)}
              width={Math.min(pct.width, 26)}
              height={4}
              fill={color}
              opacity={0.85}
            />
            <text
              x={pct.left + 1}
              y={Math.max(0, pct.top - 4) + 3}
              fill="#000"
              fontSize={2.4}
              fontFamily="monospace"
              fontWeight="700"
            >
              {d.label.toUpperCase()} {Math.round(d.score * 100)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
