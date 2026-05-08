"use client";
import { useEffect, useRef, useState } from "react";
import { X, Navigation, Zap, Target, Eye } from "lucide-react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";

const LABEL_STYLE: Record<string, string> = {
  hostile: "bg-red-600 text-white",
  neutral: "bg-orange-500 text-white",
  unknown: "bg-cyan-600 text-white",
};

const STATE_STYLE: Record<string, string> = {
  active: "bg-emerald-600/80 text-white",
  coasting: "bg-yellow-500/80 text-black",
  expired: "bg-white/20 text-white/60",
};

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-20 shrink-0 text-white/60">{label}</span>
      <div className="h-1.5 flex-1 rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-cyan-400/70 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-right text-white/50">{pct}%</span>
    </div>
  );
}

function AggressionSparkline({ values }: { values: number[] }) {
  const h = 24;
  const w = 120;
  const pts = values.slice(-60);
  if (pts.length < 2) return null;
  const xs = pts.map((_, i) => (i / (pts.length - 1)) * w);
  const ys = pts.map((v) => h - v * h);
  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i]!.toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <path d={d} fill="none" stroke="#22d3ee" strokeWidth="1.5" opacity="0.8" />
    </svg>
  );
}

export function DroneDetailPanel() {
  const followDroneId = useStore((s) => s.followDroneId);
  const droneTracks = useStore((s) => s.droneTracks);
  const droneClassifications = useStore((s) => s.droneClassifications);
  const setFollowDrone = useStore((s) => s.setFollowDrone);

  const track = droneTracks.find((t) => t.id === followDroneId) ?? null;
  const cls = followDroneId ? droneClassifications[followDroneId] : undefined;

  const historyRef = useRef<Map<string, number[]>>(new Map());
  const [sparkValues, setSparkValues] = useState<number[]>([]);

  useEffect(() => {
    if (!followDroneId || cls === undefined) return;
    const arr = historyRef.current.get(followDroneId) ?? [];
    arr.push(cls.aggressionScore);
    if (arr.length > 60) arr.splice(0, arr.length - 60);
    historyRef.current.set(followDroneId, arr);
    setSparkValues([...arr]);
  }, [cls, followDroneId]);

  if (!followDroneId || !track) return null;

  const speedKmh = ((track.velocityMs ?? 0) * 3.6).toFixed(1);
  const lastFrame = track.positionHistory.at(-1);

  return (
    <div
      data-agent="drone-detail-panel"
      className="absolute left-3 top-16 z-30 w-[320px] max-w-[38vw] rounded border border-white/15 bg-ink-900/95 p-3 backdrop-blur"
    >
      {/* Header */}
      <div className="mb-2 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className={cn("rounded px-2 py-0.5 text-[10px] font-mono uppercase", STATE_STYLE[track.state] ?? STATE_STYLE.active)}>
            {track.id} · {track.state}
          </span>
        </div>
        <button className="text-white/60 hover:text-white" aria-label="close" onClick={() => setFollowDrone(null)}>
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Classification badge */}
      {cls && (
        <div className="mb-2 flex items-center gap-2">
          <span className={cn("rounded px-2.5 py-1 text-xs font-semibold uppercase tracking-wide", LABEL_STYLE[cls.label] ?? LABEL_STYLE.unknown)}>
            {cls.label}
          </span>
          <span className="text-sm font-semibold text-white/80">
            {Math.round(cls.aggressionScore * 100)}% aggression
          </span>
          <span className="ml-auto text-[10px] text-white/40">
            conf {Math.round(cls.confidence * 100)}%
          </span>
        </div>
      )}

      {/* Metrics row */}
      <div className="mb-2 flex flex-wrap gap-3 text-[11px] text-white/70">
        <span className="flex items-center gap-1">
          <Navigation className="h-3 w-3" />
          {speedKmh} km/h
        </span>
        <span className="flex items-center gap-1">
          <Zap className="h-3 w-3" />
          {Math.round(track.headingDeg ?? 0)}°
        </span>
        {track.geo.alt !== undefined && (
          <span className="flex items-center gap-1">
            <Eye className="h-3 w-3" />
            {Math.round(track.geo.alt)} m AGL
          </span>
        )}
        {track.swarmCorrelated && (
          <span className="rounded bg-red-800/50 px-1.5 text-red-300">SWARM</span>
        )}
      </div>

      {/* Predicted target */}
      <div className="mb-2 flex items-center gap-2 text-[11px]">
        <Target className="h-3 w-3 text-white/40" />
        <span className="text-white/50">Est. target:</span>
        <span className={cn("font-medium", cls?.estimatedTarget ? "text-red-300" : "text-white/30")}>
          {cls?.estimatedTarget ?? "—"}
        </span>
      </div>

      {/* Sub-score breakdown */}
      {cls && (
        <div className="mb-2 space-y-1.5 rounded bg-white/5 p-2">
          <ScoreBar label="Evasion" value={cls.evasionScore} />
          <ScoreBar label="Loiter" value={cls.loiterRatio} />
          <ScoreBar label="Descent" value={Math.max(0, cls.descentRate / 10)} />
          <ScoreBar label="Payload stab." value={cls.payloadStability} />
          <ScoreBar label="Swarm" value={cls.swarmCorrelated ? 1 : 0} />
        </div>
      )}

      {/* Aggression sparkline */}
      {sparkValues.length > 1 && (
        <div className="mb-2">
          <div className="mb-1 text-[10px] text-white/40 uppercase tracking-wide">Aggression trend (60s)</div>
          <AggressionSparkline values={sparkValues} />
        </div>
      )}

      {/* Follow / release toggle */}
      <div className="mb-2">
        <button
          className="btn w-full text-xs"
          onClick={() => setFollowDrone(followDroneId === track.id ? null : track.id)}
        >
          {followDroneId === track.id ? "Release camera" : "Follow track"}
        </button>
      </div>

      {/* Raw payload accordion */}
      {lastFrame && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-white/50">last detection frame</summary>
          <pre className="mt-1 max-h-36 overflow-auto rounded bg-black/50 p-2 text-[10px] text-white/60">
            {JSON.stringify(lastFrame, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
