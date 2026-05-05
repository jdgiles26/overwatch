"use client";
import { useState } from "react";
import { Play, Pause, Rewind } from "lucide-react";
import { useStore } from "@/lib/store";

const PRESETS = [
  { label: "15m", ms: 15 * 60_000 },
  { label: "1h", ms: 60 * 60_000 },
  { label: "6h", ms: 6 * 60 * 60_000 },
  { label: "24h", ms: 24 * 60 * 60_000 },
];

export function TimeScrubber() {
  const window_ = useStore((s) => s.timeWindow);
  const setWin = useStore((s) => s.setTimeWindow);
  const [span, setSpan] = useState(60 * 60_000); // 1h
  const [pos, setPos] = useState(1); // 0..1, 1 = "now"

  function applyDvr(p = pos, s = span) {
    const now = Date.now();
    const earliest = now - 24 * 60 * 60_000;
    const latest = now;
    // window center moves with p between earliest and latest
    const center = earliest + p * (latest - earliest);
    setWin({ from: center - s / 2, to: center + s / 2 });
  }

  return (
    <div
      data-agent="time-scrubber"
      className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded border border-white/15 bg-ink-900/85 px-3 py-1.5 text-[11px] backdrop-blur"
    >
      {window_ ? (
        <>
          <Pause className="h-3 w-3" />
          <span>
            DVR · {new Date(window_.from).toLocaleTimeString()} →{" "}
            {new Date(window_.to).toLocaleTimeString()}
          </span>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(pos * 1000)}
            onChange={(e) => {
              const p = Number(e.target.value) / 1000;
              setPos(p);
              applyDvr(p);
            }}
            className="w-48"
          />
          <select
            className="input h-6 px-1 text-[10px]"
            value={span}
            onChange={(e) => {
              const s = Number(e.target.value);
              setSpan(s);
              applyDvr(undefined, s);
            }}
          >
            {PRESETS.map((p) => (
              <option key={p.label} value={p.ms}>
                {p.label} window
              </option>
            ))}
          </select>
          <button
            className="btn h-6 px-2 py-0 text-[10px]"
            onClick={() => setWin(null)}
            data-agent="dvr-live"
          >
            <Play className="h-3 w-3 inline" /> Live
          </button>
        </>
      ) : (
        <>
          <Play className="h-3 w-3 text-accent-400" />
          <span className="text-accent-300">LIVE</span>
          <button
            className="btn h-6 px-2 py-0 text-[10px]"
            onClick={() => {
              setPos(1);
              applyDvr(1, span);
            }}
            data-agent="dvr-rewind"
          >
            <Rewind className="h-3 w-3 inline" /> Replay last hour
          </button>
        </>
      )}
    </div>
  );
}
