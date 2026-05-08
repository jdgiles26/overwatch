"use client";
import { useMemo } from "react";
import { X, MapPin, Clock, Sparkles, ExternalLink, Plane } from "lucide-react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

const SEV_COLOR: Record<string, string> = {
  extreme: "bg-threat-extreme text-white",
  high: "bg-threat-high text-white",
  moderate: "bg-threat-elevated text-black",
  low: "bg-threat-low text-black",
  info: "bg-white/15 text-white/80",
};

export function EventDetail() {
  const id = useStore((s) => s.selectedEventId);
  const events = useStore((s) => s.events);
  const select = useStore((s) => s.selectEvent);
  const flyTo = useStore((s) => s.requestFlyTo);
  const setAnalyst = useStore((s) => s.setAnalystOpen);
  const followEntity = useStore((s) => s.setFollowEntity);

  const ev = useMemo(() => events.find((e) => e.id === id) ?? null, [events, id]);
  const related = useMemo(() => {
    if (!ev) return [];
    return events
      .filter((other) => other.id !== ev.id)
      .map((other) => {
        let score = 0;
        let reason = "";
        if (other.connectorId === ev.connectorId) {
          score += 1;
          reason = "same source";
        }
        if (other.category === ev.category) score += 1;
        if (
          ev.geo &&
          other.geo &&
          distanceKm(ev.geo, other.geo) < 100
        ) {
          score += 2;
          reason = `${distanceKm(ev.geo, other.geo).toFixed(1)}km away`;
        }
        if (
          ev.payload?.icao24 &&
          other.payload?.icao24 === ev.payload.icao24
        ) {
          score += 5;
          reason = `same aircraft ${ev.payload.icao24}`;
        }
        return { other, score, reason };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }, [events, ev]);

  if (!ev) return null;
  return (
    <div
      data-agent="event-detail"
      className="absolute right-3 top-16 z-30 w-[360px] max-w-[40vw] rounded border border-white/15 bg-ink-900/95 p-3 backdrop-blur"
    >
      <div className="mb-2 flex items-start justify-between">
        <span
          className={cn(
            "rounded px-2 py-0.5 text-[10px] uppercase",
            SEV_COLOR[ev.severity] ?? SEV_COLOR.info,
          )}
        >
          {ev.severity} · {ev.category}
        </span>
        <button
          className="text-white/60 hover:text-white"
          aria-label="close"
          onClick={() => select(null)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mb-1 text-sm font-semibold leading-snug">{ev.title}</div>
      {ev.summary && (
        <div className="mb-2 line-clamp-4 text-xs text-white/70">{ev.summary}</div>
      )}
      <div className="mb-2 flex flex-wrap gap-2 text-[11px] text-white/70">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {new Date(ev.occurredAt).toLocaleString()}
        </span>
        {ev.geo && (
          <button
            className="flex items-center gap-1 rounded bg-white/10 px-1.5 hover:bg-white/20"
            onClick={() => flyTo({ lat: ev.geo!.lat, lon: ev.geo!.lon, zoom: 7 })}
          >
            <MapPin className="h-3 w-3" />
            {ev.geo.lat.toFixed(2)}, {ev.geo.lon.toFixed(2)}
          </button>
        )}
        <span className="rounded bg-white/5 px-1.5">{ev.source}</span>
      </div>
      {ev.payload?.icao24 && (
        <div className="mb-2 flex items-center gap-2 text-[11px]">
          <span className="rounded bg-white/5 px-1.5">
            <Plane className="mr-1 inline h-3 w-3" />
            {ev.payload.callsign?.trim?.() || ev.payload.icao24}
          </span>
          <button
            className="btn"
            onClick={() =>
              followEntity({ kind: "icao24", value: ev.payload!.icao24 })
            }
          >
            Follow aircraft
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {ev.url && (
          <a
            href={ev.url}
            target="_blank"
            rel="noreferrer"
            className="btn flex items-center gap-1 text-[11px]"
          >
            <ExternalLink className="h-3 w-3" /> source
          </a>
        )}
        <button
          className="btn flex items-center gap-1 text-[11px]"
          onClick={() => {
            setAnalyst(true);
            try {
              window.dispatchEvent(
                new CustomEvent("overwatch:analyst-prompt", {
                  detail: `Brief me on this event: ${ev.title} (${ev.severity}/${ev.category}${
                    ev.geo ? ` @ ${ev.geo.lat.toFixed(2)},${ev.geo.lon.toFixed(2)}` : ""
                  }). What other events look related?`,
                }),
              );
            } catch {
              /* ignore */
            }
          }}
        >
          <Sparkles className="h-3 w-3" /> Ask analyst
        </button>
      </div>
      {ev.payload && (
        <details className="mt-2 text-[11px]">
          <summary className="cursor-pointer text-white/60">raw payload</summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded bg-black/50 p-2 text-[10px] text-white/70">
            {JSON.stringify(ev.payload, null, 2)}
          </pre>
        </details>
      )}
      {related.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-white/50">
            Related events
          </div>
          <ul className="space-y-1">
            {related.map((r) => (
              <li key={r.other.id}>
                <button
                  className="w-full rounded bg-white/5 p-1 text-left hover:bg-white/10"
                  onClick={() => select(r.other.id)}
                >
                  <div className="text-[11px] line-clamp-1">{r.other.title}</div>
                  <div className="text-[10px] text-white/50">
                    {r.other.severity}/{r.other.category} · {r.reason}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
