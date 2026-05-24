"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import {
  CheckCircle2,
  CircleAlert,
  ShieldAlert,
  Sparkles,
  MapPin,
  ChevronDown,
} from "lucide-react";
import { buildPirEvidence, pirShowOnMapTarget } from "@/lib/pirDetail";

export function AssessmentPanel() {
  const tc = useStore((s) => s.threatcon);
  const pirs = useStore((s) => s.pirs);
  const status = useStore((s) => s.status);
  const events = useStore((s) => s.events);
  const select = useStore((s) => s.selectEvent);
  const flyTo = useStore((s) => s.requestFlyTo);
  const [expanded, setExpanded] = useState<string | null>(null);

  const sevCounts = events.reduce(
    (acc, e) => {
      acc[e.severity] = (acc[e.severity] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div
      className="scrollable flex h-full min-h-0 w-80 flex-col gap-3 overflow-y-auto border-l border-white/5 bg-ink-900/50 p-3"
      data-agent="assessment-panel"
    >
      <div className="panel p-3" data-agent="threatcon-card">
        <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-white/50">
          <ShieldAlert className="h-3.5 w-3.5" />
          THREATCON
        </div>
        {tc ? (
          <>
            <div className="flex items-end justify-between">
              <div
                className={cn(
                  "text-4xl font-semibold tabular-nums",
                  tc.level === "nominal" && "text-threat-nominal",
                  tc.level === "guarded" && "text-threat-guarded",
                  tc.level === "elevated" && "text-threat-elevated",
                  tc.level === "high" && "text-threat-high",
                  tc.level === "critical" && "text-threat-critical",
                )}
              >
                {tc.score.toFixed(1)}
              </div>
              <div className="text-right">
                <div className="text-xs uppercase text-white/50">Level</div>
                <div className="font-semibold capitalize">{tc.level}</div>
              </div>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/5">
              <div
                className={cn(
                  "h-full rounded-full",
                  tc.level === "nominal" && "bg-threat-nominal",
                  tc.level === "guarded" && "bg-threat-guarded",
                  tc.level === "elevated" && "bg-threat-elevated",
                  tc.level === "high" && "bg-threat-high",
                  tc.level === "critical" && "bg-threat-critical",
                )}
                style={{ width: `${(tc.score / 10) * 100}%` }}
              />
            </div>
            {tc.reasons.length > 0 && (
              <ul className="mt-3 space-y-1 text-[11px] text-white/60">
                {tc.reasons.map((r, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <CircleAlert className="mt-0.5 h-3 w-3 shrink-0 text-threat-elevated" />
                    {r}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="text-xs text-white/40">Computing…</div>
        )}
      </div>

      <div className="panel p-3" data-agent="pir-card">
        <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-white/50">
          <Sparkles className="h-3.5 w-3.5" />
          Priority Intelligence
        </div>
        <ul className="space-y-1.5">
          {pirs.map((p) => {
            const isOpen = expanded === p.id;
            const target = pirShowOnMapTarget(p, events);
            const { events: evidence } = buildPirEvidence(p, events);
            return (
              <li
                key={p.id}
                className="rounded-md border border-white/5 bg-ink-800/50"
                data-agent={`pir-${p.id}`}
              >
                <button
                  type="button"
                  className="flex w-full items-start gap-2 p-2 text-left hover:bg-white/5"
                  onClick={() => setExpanded(isOpen ? null : p.id)}
                  aria-expanded={isOpen}
                  data-agent={`pir-${p.id}-toggle`}
                >
                  <span
                    className={cn(
                      "mt-0.5 inline-flex h-5 w-10 items-center justify-center rounded-full text-[10px] font-semibold uppercase",
                      p.answer === "yes" && "bg-threat-high/20 text-threat-high",
                      p.answer === "no" && "bg-threat-nominal/20 text-threat-nominal",
                      p.answer === "unknown" && "bg-white/10 text-white/60",
                    )}
                  >
                    {p.answer}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] leading-tight text-white/80">
                      {p.question}
                    </div>
                    {p.detail && (
                      <div className="text-[10px] text-white/40">{p.detail}</div>
                    )}
                  </div>
                  <ChevronDown
                    className={cn(
                      "mt-0.5 h-3.5 w-3.5 shrink-0 text-white/40 transition-transform",
                      isOpen && "rotate-180",
                    )}
                  />
                </button>
                {isOpen && (
                  <div className="border-t border-white/5 p-2">
                    <div className="mb-2 flex items-center gap-2">
                      <button
                        type="button"
                        className="btn flex items-center gap-1 text-[11px] disabled:opacity-40"
                        onClick={() => {
                          if (!target) return;
                          flyTo(target);
                        }}
                        disabled={!target}
                        data-agent={`pir-${p.id}-show-on-map`}
                      >
                        <MapPin className="h-3 w-3" />
                        Show on map
                      </button>
                      <span className="text-[10px] text-white/40">
                        {evidence.length === 0
                          ? "No linked evidence"
                          : `${evidence.length} evidence event${evidence.length === 1 ? "" : "s"}`}
                      </span>
                    </div>
                    {evidence.length > 0 && (
                      <ul className="space-y-1">
                        {evidence.slice(0, 6).map((e) => (
                          <li key={e.id}>
                            <button
                              type="button"
                              className="w-full truncate rounded px-2 py-1 text-left text-[11px] text-white/70 hover:bg-white/5"
                              onClick={() => {
                                select(e.id);
                                if (e.geo) flyTo({ lat: e.geo.lat, lon: e.geo.lon, zoom: 7 });
                              }}
                              data-agent={`pir-${p.id}-evidence-${e.id}`}
                            >
                              <span className="text-white/40">[{e.severity}]</span>{" "}
                              {e.title}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="panel p-3" data-agent="source-health-card">
        <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-white/50">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Source Health
        </div>
        <ul className="space-y-1.5 text-[11px]">
          {status.length === 0 && (
            <li className="text-white/40">No connectors configured.</li>
          )}
          {status.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-2 rounded-md border border-white/5 bg-ink-800/40 px-2 py-1"
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  s.connected ? "bg-accent-400 animate-pulse" : "bg-white/30",
                )}
              />
              <span className="flex-1 truncate">{s.label}</span>
              <span className="tabular-nums text-white/50">{s.eventsLastMinute}/m</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel p-3">
        <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-white/50">
          Severity mix
        </div>
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/5">
          <Bar c="bg-threat-critical" v={sevCounts.extreme ?? 0} />
          <Bar c="bg-threat-high" v={sevCounts.high ?? 0} />
          <Bar c="bg-threat-elevated" v={sevCounts.moderate ?? 0} />
          <Bar c="bg-accent-400" v={sevCounts.low ?? 0} />
          <Bar c="bg-white/30" v={sevCounts.info ?? 0} />
        </div>
        <div className="mt-2 grid grid-cols-5 gap-1 text-center text-[10px] text-white/50">
          <div>{sevCounts.extreme ?? 0}</div>
          <div>{sevCounts.high ?? 0}</div>
          <div>{sevCounts.moderate ?? 0}</div>
          <div>{sevCounts.low ?? 0}</div>
          <div>{sevCounts.info ?? 0}</div>
        </div>
      </div>
    </div>
  );
}

function Bar({ c, v }: { c: string; v: number }) {
  const pct = Math.max(2, Math.min(60, v));
  return <div className={cn("h-full", c)} style={{ flex: pct }} />;
}
