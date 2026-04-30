"use client";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import {
  Camera,
  Cpu,
  Eye,
  Loader2,
  Pause,
  Play,
  Square,
  StopCircle,
  X,
  Zap,
} from "lucide-react";

const MISSION_PRESETS = [
  "Switch to 3D globe and fly to the highest-severity event.",
  "Open Connectors page and report enabled sources.",
  "Toggle night vision, then summarize what changed.",
  "Inspect the current THREATCON and its top reasons.",
];

type Step = {
  ts: number;
  thought: string;
  action?: { type: string; target?: string; value?: any };
  result?: string;
  caption?: string;
};

export function OverseerPanel() {
  const open = useStore((s) => s.overseerOpen);
  const setOpen = useStore((s) => s.setOverseerOpen);
  const [mission, setMission] = useState(MISSION_PRESETS[0]!);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [budget, setBudget] = useState(8);
  const [device, setDevice] = useState<string>("");
  const [progress, setProgress] = useState<string>("");
  const stopRef = useRef(false);

  useEffect(() => {
    function escTriple(e: KeyboardEvent) {
      if (!running) return;
      if (e.key === "Escape") {
        stopRef.current = true;
        setRunning(false);
      }
    }
    window.addEventListener("keydown", escTriple);
    return () => window.removeEventListener("keydown", escTriple);
  }, [running]);

  async function start() {
    if (running) return;
    setSteps([]);
    setRunning(true);
    setPaused(false);
    stopRef.current = false;

    const { runOverseer } = await import("@/lib/agent");
    try {
      await runOverseer({
        mission,
        budget,
        onProgress: (m) => setProgress(m),
        onDevice: (d) => setDevice(d),
        onStep: (s) => setSteps((arr) => [...arr, s]),
        shouldStop: () => stopRef.current,
        isPaused: () => paused,
      });
    } catch (e: any) {
      setSteps((arr) => [...arr, { ts: Date.now(), thought: `Error: ${e.message ?? e}` }]);
    } finally {
      setRunning(false);
      setProgress("");
    }
  }

  function stop() {
    stopRef.current = true;
    setRunning(false);
  }

  if (!open) return null;
  return (
    <div className="absolute right-2 top-14 z-30 flex h-[calc(100vh-180px)] w-[420px] flex-col panel" data-agent="overseer">
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
        <Eye className="h-4 w-4 text-accent-400" />
        <div className="text-sm font-semibold">Overseer</div>
        <span className="badge gap-1">
          <Cpu className="h-3 w-3" />
          {device || "ready"}
        </span>
        <span className="badge ml-auto gap-1">
          <Zap className="h-3 w-3" />
          {steps.length}/{budget}
        </span>
        <button onClick={() => setOpen(false)} className="text-white/40 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="border-b border-white/5 p-3">
        <label className="mb-1 block text-[10px] uppercase tracking-wider text-white/50">
          Mission
        </label>
        <textarea
          value={mission}
          onChange={(e) => setMission(e.target.value)}
          rows={2}
          disabled={running}
          className="w-full rounded-md border border-white/10 bg-ink-800/60 px-2 py-1.5 text-sm outline-none focus:border-accent-500/40"
          data-agent="overseer-mission"
        />
        <div className="mt-1 flex flex-wrap gap-1">
          {MISSION_PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setMission(p)}
              disabled={running}
              className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/60 hover:bg-white/5"
            >
              {p.slice(0, 30)}…
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <label className="text-[10px] uppercase text-white/50">Budget</label>
          <input
            type="number"
            value={budget}
            min={1}
            max={20}
            onChange={(e) => setBudget(Number(e.target.value))}
            className="w-16 rounded border border-white/10 bg-ink-800/60 px-1 py-0.5 text-xs"
          />
          {!running ? (
            <button
              onClick={start}
              className="ml-auto flex items-center gap-1 rounded bg-accent-500/20 px-2 py-1 text-xs text-accent-400 hover:bg-accent-500/30"
              data-agent="overseer-start"
            >
              <Play className="h-3 w-3" /> Start
            </button>
          ) : (
            <>
              <button
                onClick={() => setPaused((p) => !p)}
                className="ml-auto flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-xs"
              >
                {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                {paused ? "Resume" : "Pause"}
              </button>
              <button
                onClick={stop}
                className="flex items-center gap-1 rounded bg-threat-high/20 px-2 py-1 text-xs text-threat-high"
              >
                <StopCircle className="h-3 w-3" /> Stop
              </button>
            </>
          )}
        </div>
        {progress && (
          <div className="mt-2 flex items-center gap-2 text-[11px] text-white/50">
            <Loader2 className="h-3 w-3 animate-spin" /> {progress}
          </div>
        )}
        <div className="mt-1 text-[10px] text-white/30">
          Esc to abort. Agent only acts on elements tagged <code>data-agent</code>.
        </div>
      </div>

      <div className="scrollable flex-1 overflow-y-auto p-3 text-sm">
        {steps.length === 0 && (
          <div className="text-xs text-white/40">
            <Camera className="mr-1 inline h-3 w-3" /> Step transcript will appear here.
          </div>
        )}
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li
              key={i}
              className="rounded-md border border-white/5 bg-ink-800/60 p-2 text-xs"
            >
              <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-white/40">
                <span>step {i + 1}</span>
                {s.action && (
                  <span className="rounded bg-accent-500/20 px-1.5 text-accent-400">
                    {s.action.type}
                    {s.action.target ? ` · ${s.action.target}` : ""}
                  </span>
                )}
              </div>
              <div className="text-white/80">{s.thought}</div>
              {s.caption && (
                <div className="mt-1 text-[11px] italic text-white/50">vision: {s.caption}</div>
              )}
              {s.result && (
                <div className="mt-1 text-[11px] text-accent-400">→ {s.result}</div>
              )}
            </li>
          ))}
        </ol>
      </div>

      <div className="border-t border-white/5 px-3 py-2 text-[10px] text-white/40">
        <Square className="mr-1 inline h-3 w-3" /> Sandboxed: clicks restricted to whitelisted
        targets. WebGPU vision via SmolVLM/ViT.
      </div>
    </div>
  );
}
