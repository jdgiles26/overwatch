"use client";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { Bot, Loader2, Send, Square, Sparkles, X, Cpu, Database } from "lucide-react";
import { cn } from "@/lib/cn";

type ChatMsg =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "tool"; name: string; content: string };

const DEFAULT_SYSTEM = `You are OverWatch Analyst, a concise OSINT/IoT intelligence assistant.
You see live event metadata. Always cite event titles by name.
If asked to plot or focus, respond with a JSON block like {"action":"flyTo","lat":..,"lon":..,"zoom":..}.
You may answer Priority Intelligence Requirements (PIRs) directly.
Keep responses under 120 words unless asked.`;

export function AnalystPanel() {
  const open = useStore((s) => s.analystOpen);
  const setOpen = useStore((s) => s.setAnalystOpen);
  const events = useStore((s) => s.events);
  const tc = useStore((s) => s.threatcon);
  const pirs = useStore((s) => s.pirs);
  const status = useStore((s) => s.status);
  const flyTo = useStore((s) => s.requestFlyTo);

  const [msgs, setMsgs] = useState<ChatMsg[]>([
    {
      role: "assistant",
      content:
        "Analyst online. Ask me about active alerts, the THREATCON, or any event in the feed. I run on-device via WebGPU with `@huggingface/transformers`.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [device, setDevice] = useState<"webgpu" | "wasm" | "cpu" | null>(null);
  const [model, setModel] = useState("HuggingFaceTB/SmolLM2-360M-Instruct");
  const stopRef = useRef<{ stop: () => void } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 999999, behavior: "smooth" });
  }, [msgs]);

  async function send() {
    if (!input.trim() || busy) return;
    const user = input.trim();
    setInput("");
    setMsgs((m) => [...m, { role: "user", content: user }]);
    setBusy(true);
    try {
      const ctx = buildContext({ events, tc, pirs, status });
      const sys = `${DEFAULT_SYSTEM}\n\n--- LIVE CONTEXT ---\n${ctx}\n--- END CONTEXT ---`;
      const messages = [
        { role: "system" as const, content: sys },
        ...msgs
          .filter((m): m is Extract<ChatMsg, { role: "system" | "user" | "assistant" }> =>
            m.role !== "tool",
          )
          .map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: user },
      ];

      const { runChat } = await import("@/lib/ai");
      let out = "";
      stopRef.current = await runChat({
        model,
        messages,
        onProgress: (p) => setProgress(p),
        onDevice: (d) => setDevice(d),
        onToken: (t) => {
          out += t;
          setMsgs((arr) => {
            const next = [...arr];
            const last = next[next.length - 1];
            if (last && last.role === "assistant" && (last as any).streaming) {
              (last as any).content = out;
            } else {
              next.push({ role: "assistant", content: out, ...({ streaming: true } as any) });
            }
            return next;
          });
        },
      });
      // Finalize
      setMsgs((arr) => {
        const next = [...arr];
        const last = next[next.length - 1] as any;
        if (last?.streaming) {
          delete last.streaming;
        }
        return next;
      });
      // Parse simple actions
      const m = out.match(/\{\s*"action"\s*:\s*"flyTo"[^}]*\}/);
      if (m) {
        try {
          const obj = JSON.parse(m[0]);
          if (obj.lat != null && obj.lon != null) flyTo({ lat: obj.lat, lon: obj.lon, zoom: obj.zoom ?? 6 });
        } catch {
          /* ignore */
        }
      }
    } catch (e: any) {
      setMsgs((arr) => [...arr, { role: "assistant", content: `Error: ${e.message ?? e}` }]);
    } finally {
      setBusy(false);
      setProgress(null);
      stopRef.current = null;
    }
  }

  function stop() {
    stopRef.current?.stop();
  }

  if (!open) return null;
  return (
    <div className="absolute right-2 top-14 z-30 flex h-[calc(100vh-180px)] w-[420px] flex-col panel" data-agent="analyst">
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
        <Bot className="h-4 w-4 text-accent-400" />
        <div className="text-sm font-semibold">Analyst</div>
        <span className="badge gap-1">
          <Cpu className="h-3 w-3" />
          {device ?? "ready"}
        </span>
        <select
          className="ml-auto bg-transparent text-[11px] text-white/50"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          <option value="HuggingFaceTB/SmolLM2-360M-Instruct">SmolLM2-360M</option>
          <option value="HuggingFaceTB/SmolLM2-1.7B-Instruct">SmolLM2-1.7B</option>
          <option value="onnx-community/Qwen2.5-0.5B-Instruct">Qwen2.5-0.5B</option>
          <option value="onnx-community/Llama-3.2-1B-Instruct">Llama-3.2-1B</option>
        </select>
        <button onClick={() => setOpen(false)} className="text-white/40 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div ref={scrollRef} className="scrollable flex-1 space-y-2 overflow-y-auto px-3 py-2 text-sm">
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-md bg-accent-500/15 px-3 py-2">
              {m.content}
            </div>
          ) : m.role === "assistant" ? (
            <div key={i} className="max-w-[90%] rounded-md bg-ink-800/60 px-3 py-2 leading-relaxed">
              {m.content}
            </div>
          ) : null,
        )}
        {progress && (
          <div className="flex items-center gap-2 text-[11px] text-white/40">
            <Loader2 className="h-3 w-3 animate-spin" /> {progress}
          </div>
        )}
      </div>
      <div className="border-t border-white/5 p-2">
        <div className="flex items-center gap-1 text-[10px] text-white/40">
          <Database className="h-3 w-3" /> {events.length} events in context · THREATCON {tc?.score.toFixed(1) ?? "—"}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask the analyst…"
            className="flex-1 rounded-md border border-white/10 bg-ink-800/60 px-2 py-1.5 text-sm outline-none focus:border-accent-500/40"
            data-agent="analyst-input"
          />
          {busy ? (
            <button onClick={stop} className={cn("rounded bg-threat-high/20 px-2 py-1.5 text-threat-high")}>
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={send}
              className="rounded bg-accent-500/20 px-2 py-1.5 text-accent-400 hover:bg-accent-500/30"
              data-agent="analyst-send"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
          {[
            "Summarize the THREATCON",
            "Any earthquakes M4+?",
            "Air quality near my locations?",
            "Show fires on the map",
          ].map((p) => (
            <button
              key={p}
              onClick={() => setInput(p)}
              className="rounded-full border border-white/10 px-2 py-0.5 text-white/50 hover:bg-white/5"
            >
              <Sparkles className="mr-1 inline h-3 w-3" />
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function buildContext(args: {
  events: any[];
  tc: any;
  pirs: any[];
  status: any[];
}) {
  const top = args.events.slice(0, 12).map(
    (e) =>
      `- [${e.severity}] ${e.category} • ${e.title} ${
        e.geoMentioned ? `(${e.geoMentioned})` : ""
      }`,
  );
  const pir = args.pirs.map((p) => `- ${p.question} → ${p.answer}`);
  const tc = args.tc
    ? `THREATCON ${args.tc.score} (${args.tc.level}). Reasons: ${args.tc.reasons.join("; ") || "none"}.`
    : "";
  const sources = args.status
    .filter((s) => s.connected)
    .map((s) => s.label)
    .slice(0, 10)
    .join(", ");
  return `${tc}\nTop events:\n${top.join("\n")}\nPIRs:\n${pir.join("\n")}\nLive sources: ${sources}`;
}
