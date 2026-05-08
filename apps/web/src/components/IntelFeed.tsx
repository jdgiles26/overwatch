"use client";
import { useMemo } from "react";
import { applyFilter, useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import type { IngestEvent } from "@overwatch/schemas";
import {
  Activity,
  AlertTriangle,
  Bolt,
  Cloud,
  Flame,
  Plane,
  Radio,
  Search,
  Waves,
  Wind,
  Coins,
  MessageCircle,
  Newspaper,
  Book,
  Rocket,
  Satellite,
  Webhook,
} from "lucide-react";

const CATS = [
  "weather",
  "seismic",
  "air",
  "transport",
  "power",
  "fire",
  "news",
  "iot",
  "cv",
  "drone",
  "space",
  "finance",
  "social",
];
const SEVS = ["info", "low", "moderate", "high", "extreme"];

// Shorten full topic labels to concise chips
function shortTopic(t: string): string {
  if (t.includes("infrastructure")) return "infra";
  if (t.includes("civil unrest")) return "unrest";
  if (t.includes("natural disaster")) return "disaster";
  if (t.includes("cyber")) return "cyber";
  if (t.includes("health")) return "health";
  if (t.includes("environmental") || t.includes("chemical")) return "hazmat";
  if (t.includes("armed conflict") || t.includes("military")) return "conflict";
  if (t.includes("accident") || t.includes("industrial")) return "accident";
  return t.split(" ")[0]!;
}

export function IntelFeed() {
  const events = useStore((s) => s.events);
  const eventTopics = useStore((s) => s.eventTopics);
  const filter = useStore((s) => s.filter);
  const toggleCat = useStore((s) => s.toggleCategory);
  const toggleSev = useStore((s) => s.toggleSeverity);
  const setQuery = useStore((s) => s.setQuery);
  const selected = useStore((s) => s.selectedEventId);
  const select = useStore((s) => s.selectEvent);
  const flyTo = useStore((s) => s.requestFlyTo);

  const timeWindow = useStore((s) => s.timeWindow);
  const filtered = useMemo(
    () => applyFilter(events, filter, timeWindow),
    [events, filter, timeWindow],
  );

  return (
    <div
      className="flex h-full min-h-0 w-80 flex-col gap-2 border-r border-white/5 bg-ink-900/50 p-2"
      data-agent="intel-feed"
    >
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-white/40" />
        <input
          type="search"
          placeholder="Search intel feed…"
          value={filter.query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-md border border-white/10 bg-ink-800/50 px-2 py-1 text-xs outline-none placeholder:text-white/30 focus:border-accent-500/40"
          data-agent="intel-search"
        />
      </div>

      <div className="flex flex-wrap gap-1">
        {CATS.map((c) => (
          <button
            key={c}
            onClick={() => toggleCat(c)}
            className={cn(
              "rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider",
              filter.categories.has(c)
                ? "bg-accent-500/20 text-accent-400 border-accent-500/40"
                : "text-white/50 hover:bg-white/5",
            )}
            data-agent={`cat-${c}`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="flex gap-1">
        {SEVS.map((s) => (
          <button
            key={s}
            onClick={() => toggleSev(s)}
            className={cn(
              "rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider",
              filter.severities.has(s)
                ? "border-accent-500/40 bg-accent-500/20 text-accent-400"
                : "text-white/50 hover:bg-white/5",
            )}
            data-agent={`sev-${s}`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="scrollable -mx-1 flex-1 overflow-y-auto px-1">
        <ul className="space-y-1">
          {filtered.slice(0, 400).map((e) => (
            <li key={e.id}>
              <button
                className={cn(
                  "group flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-left hover:border-white/10 hover:bg-white/5",
                  selected === e.id && "border-accent-500/40 bg-accent-500/10",
                )}
                onClick={() => {
                  select(e.id);
                  if (e.geo) flyTo({ lat: e.geo.lat, lon: e.geo.lon, zoom: 7 });
                }}
                data-agent={`event-${e.id}`}
              >
                <div
                  className={cn(
                    "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                    severityBg(e.severity),
                  )}
                >
                  <EventIcon ev={e} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="truncate font-medium">{e.title}</span>
                    <span className="ml-auto shrink-0 text-[10px] uppercase text-white/40">
                      {e.category}
                    </span>
                  </div>
                  <div className="truncate text-[11px] text-white/50">
                    {e.summary ?? e.source}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-white/35">
                    <span>{relativeTime(e.receivedAt)}</span>
                    {e.geoMentioned && (
                      <span className="truncate">· {e.geoMentioned}</span>
                    )}
                  </div>
                  {eventTopics[e.id]?.length ? (
                    <div className="mt-0.5 flex flex-wrap gap-0.5">
                      {eventTopics[e.id]!.map((t) => (
                        <span
                          key={t}
                          title={t}
                          className="rounded-sm bg-threat-elevated/15 px-1 py-px text-[9px] uppercase tracking-wide text-threat-elevated/80"
                        >
                          {shortTopic(t)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-2 py-12 text-center text-xs text-white/30">
              No events yet. Connect data sources →
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

function severityBg(s: string) {
  switch (s) {
    case "extreme":
      return "bg-threat-critical/20 text-threat-critical";
    case "high":
      return "bg-threat-high/20 text-threat-high";
    case "moderate":
      return "bg-threat-elevated/20 text-threat-elevated";
    case "low":
      return "bg-accent-500/15 text-accent-400";
    default:
      return "bg-white/5 text-white/50";
  }
}

function EventIcon({ ev }: { ev: IngestEvent }) {
  const icon = ev.icon;
  const c = "h-3.5 w-3.5";
  if (icon === "cloud-lightning") return <Bolt className={c} />;
  if (icon === "waves") return <Waves className={c} />;
  if (icon === "flame") return <Flame className={c} />;
  if (icon === "plane") return <Plane className={c} />;
  if (icon === "wind") return <Wind className={c} />;
  if (icon === "cloud") return <Cloud className={c} />;
  if (icon === "radio") return <Radio className={c} />;
  if (icon === "coins") return <Coins className={c} />;
  if (icon === "message-circle") return <MessageCircle className={c} />;
  if (icon === "message-square") return <MessageCircle className={c} />;
  if (icon === "newspaper") return <Newspaper className={c} />;
  if (icon === "book") return <Book className={c} />;
  if (icon === "rocket") return <Rocket className={c} />;
  if (icon === "satellite") return <Satellite className={c} />;
  if (icon === "webhook") return <Webhook className={c} />;
  if (ev.category === "seismic") return <Waves className={c} />;
  if (ev.category === "weather") return <Cloud className={c} />;
  if (ev.category === "fire") return <Flame className={c} />;
  if (ev.category === "transport") return <Plane className={c} />;
  if (ev.category === "air") return <Wind className={c} />;
  return <Activity className={c} />;
}

function relativeTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60_000) return `${Math.floor(d / 1000)}s`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
  return `${Math.floor(d / 86_400_000)}d`;
}

void AlertTriangle;
