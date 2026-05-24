"use client";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import {
  Bot,
  Loader2,
  Send,
  Square,
  Sparkles,
  X,
  Cpu,
  Database,
  ClipboardList,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { apiGet } from "@/lib/api";

type ChatMsg =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "tool"; name: string; content: string };

const DEFAULT_SYSTEM = `You are OverWatch Analyst, a concise OSINT / IoT intelligence assistant.

IDENTITY (do NOT contradict):
- You run fully on-device in the user's browser via @huggingface/transformers.
- You do NOT use TensorFlow, PyTorch, Gluon, OpenAI, or any cloud API.
- If asked which model you are, answer with the exact model id provided to you.
- If you don't know something, say "I don't have that information." Do not invent facts.

GROUND TRUTH:
- The LIVE CONTEXT block below is the ONLY source of truth for events, THREATCON, PIRs, and feeds.
- Cite event titles verbatim. Do not invent events that aren't in the context.

ACTIONS:
- To plot or focus the map, emit exactly one JSON object on its own line:
  {"action":"flyTo","lat":<number>,"lon":<number>,"zoom":<number>}
- After any action JSON, append a one-sentence rationale.

STYLE:
- One paragraph, under 120 words, unless explicitly asked for more.
- Never repeat the same sentence twice. Never loop.`;

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
  const [ttsOn, setTtsOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const stopRef = useRef<{ stop: () => void; done: Promise<string> } | null>(null);
  const recRef = useRef<{ stop: () => Promise<void>; abort: () => void } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 999999, behavior: "smooth" });
  }, [msgs]);

  // Listen for "Ask analyst" button from EventDetail.
  useEffect(() => {
    function onPrompt(ev: Event) {
      const detail = (ev as CustomEvent).detail;
      if (typeof detail === "string") {
        setInput(detail);
      }
    }
    window.addEventListener("overwatch:analyst-prompt", onPrompt);
    return () => window.removeEventListener("overwatch:analyst-prompt", onPrompt);
  }, []);

  async function runBriefing() {
    if (busy) return;
    setBusy(true);
    setMsgs((m) => [
      ...m,
      { role: "user", content: "Generate a tactical situational briefing." },
    ]);
    try {
      const ctx = await apiGet<any>("/api/briefing-context");
      const sys = `You are OverWatch Analyst preparing a 5-section tactical briefing.
Output structured markdown with sections:
1. EXECUTIVE SUMMARY (2 sentences)
2. THREATCON (one line: score + main drivers)
3. PRIORITY EVENTS (3 bullets, each with severity, where, why)
4. PIR ANSWERS (one bullet per PIR)
5. RECOMMENDED ACTIONS (3 short bullets)
Be precise. Cite event titles. No filler.`;
      const user = `LIVE INTEL:\n${JSON.stringify(ctx, null, 2)}`;
      const { runChat } = await import("@/lib/ai");
      let out = "";
      const handle = await runChat({
        model,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        maxNewTokens: 360,
        temperature: 0.3,
        onProgress: setProgress,
        onDevice: setDevice,
        onToken: (t) => {
          out += t;
          setMsgs((arr) => {
            const next = [...arr];
            const last = next[next.length - 1];
            if (last && last.role === "assistant" && (last as any).streaming) {
              next[next.length - 1] = { ...last, content: out } as any;
            } else {
              next.push({
                role: "assistant",
                content: out,
                ...({ streaming: true } as any),
              });
            }
            return next;
          });
        },
      });
      stopRef.current = handle;
      const final = (await handle.done) || out;
      setMsgs((arr) => {
        const next = [...arr];
        const last = next[next.length - 1] as any;
        if (last?.streaming)
          next[next.length - 1] = { role: "assistant", content: final };
        return next;
      });
      if (ttsOn) {
        try {
          const { speak } = await import("@/lib/voice");
          await speak(final);
        } catch {
          /* tts optional */
        }
      }
    } catch (e: any) {
      setMsgs((arr) => [
        ...arr,
        { role: "assistant", content: `Briefing failed: ${e.message ?? e}` },
      ]);
    } finally {
      setBusy(false);
      setProgress(null);
      stopRef.current = null;
    }
  }

  async function toggleVoice() {
    if (recording) {
      await recRef.current?.stop();
      return;
    }
    try {
      const { startRecording } = await import("@/lib/voice");
      setRecording(true);
      setProgress("Listening…");
      const handle = await startRecording(async (text) => {
        setProgress(null);
        setRecording(false);
        if (text && text.trim()) {
          setInput(text);
          // auto-send after STT.
          setTimeout(() => send(text), 50);
        }
      });
      recRef.current = handle;
    } catch (e: any) {
      setRecording(false);
      setProgress(null);
      setMsgs((arr) => [
        ...arr,
        { role: "assistant", content: `Voice error: ${e?.message ?? e}` },
      ]);
    }
  }

  async function send(forced?: string) {
    const text = (forced ?? input).trim();
    if (!text || busy) return;
    const user = text;
    setInput("");
    setMsgs((m) => [...m, { role: "user", content: user }]);
    setBusy(true);
    try {
      const ctx = buildContext({ events, tc, pirs, status });
      const sys = `${DEFAULT_SYSTEM}\n\nMODEL_ID: ${model}\n\n--- LIVE CONTEXT ---\n${ctx}\n--- END CONTEXT ---`;
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
      const handle = await runChat({
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
              next[next.length - 1] = {
                ...last,
                content: out,
              } as any;
            } else {
              next.push({
                role: "assistant",
                content: out,
                ...({ streaming: true } as any),
              });
            }
            return next;
          });
        },
      });
      stopRef.current = handle;
      // Wait for the model to actually finish generating before flipping busy off.
      const final = await handle.done;
      const result = final || out;
      setMsgs((arr) => {
        const next = [...arr];
        const last = next[next.length - 1] as any;
        if (last?.streaming) {
          next[next.length - 1] = {
            role: "assistant",
            content: result || last.content,
          };
        } else if (result) {
          next.push({ role: "assistant", content: result });
        }
        return next;
      });
      const m = result.match(/\{\s*"action"\s*:\s*"flyTo"[^}]*\}/);
      if (m) {
        try {
          const obj = JSON.parse(m[0]);
          if (obj.lat != null && obj.lon != null)
            flyTo({ lat: obj.lat, lon: obj.lon, zoom: obj.zoom ?? 6 });
        } catch {
          /* ignore */
        }
      }
      if (ttsOn && result) {
        try {
          const { speak } = await import("@/lib/voice");
          await speak(result.replace(/```[\s\S]*?```/g, ""));
        } catch {
          /* ignore */
        }
      }
    } catch (e: any) {
      setMsgs((arr) => [
        ...arr,
        { role: "assistant", content: `Error: ${e.message ?? e}` },
      ]);
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
        <button
          onClick={() => setTtsOn((x) => !x)}
          title={ttsOn ? "Disable speech" : "Enable speech"}
          className={cn(
            "text-white/40 hover:text-white",
            ttsOn && "text-accent-400",
          )}
          data-agent="analyst-tts"
        >
          {ttsOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </button>
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
          <button
            type="button"
            onClick={toggleVoice}
            title={recording ? "Stop listening" : "Voice input"}
            className={cn(
              "rounded px-2 py-1.5",
              recording
                ? "bg-threat-high/30 text-threat-high"
                : "bg-white/5 text-white/60 hover:bg-white/10",
            )}
            data-agent="analyst-mic"
          >
            {recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
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
              onClick={() => send()}
              className="rounded bg-accent-500/20 px-2 py-1.5 text-accent-400 hover:bg-accent-500/30"
              data-agent="analyst-send"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
          <button
            onClick={runBriefing}
            disabled={busy}
            className="rounded-full border border-accent-500/40 bg-accent-500/15 px-2 py-0.5 text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
            data-agent="analyst-briefing"
          >
            <ClipboardList className="mr-1 inline h-3 w-3" />
            Generate briefing
          </button>
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
