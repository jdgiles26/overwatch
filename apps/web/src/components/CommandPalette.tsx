"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";

type Cmd = {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const router = useRouter();
  const setView = useStore((s) => s.setView);
  const setNight = useStore((s) => s.setNightVision);
  const setAnalyst = useStore((s) => s.setAnalystOpen);
  const setOverseer = useStore((s) => s.setOverseerOpen);
  const setWindow = useStore((s) => s.setTimeWindow);
  const requestFly = useStore((s) => s.requestFlyTo);
  const events = useStore((s) => s.events);
  const clearFilters = useStore((s) => s.clearFilters);
  const toggleSev = useStore((s) => s.toggleSeverity);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((x) => !x);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const cmds: Cmd[] = useMemo(() => {
    const sevRank: Record<string, number> = {
      extreme: 4,
      high: 3,
      moderate: 2,
      low: 1,
      info: 0,
    };
    const top = [...events]
      .filter((e) => e.geo)
      .sort((a, b) => (sevRank[b.severity] ?? 0) - (sevRank[a.severity] ?? 0))[0];
    return [
      { id: "view-3d", label: "Switch to 3D globe", run: () => setView("map3d") },
      { id: "view-2d", label: "Switch to 2D map", run: () => setView("map2d") },
      { id: "view-split", label: "Split view (3D + 2D)", run: () => setView("split") },
      { id: "night", label: "Toggle night vision", run: () => setNight(!useStore.getState().nightVision) },
      { id: "analyst", label: "Open Analyst", run: () => setAnalyst(true) },
      { id: "overseer", label: "Open Overseer", run: () => setOverseer(true) },
      { id: "rules", label: "Manage alert rules", run: () => router.push("/rules") },
      { id: "connectors", label: "Manage connectors", run: () => router.push("/connectors") },
      { id: "live", label: "DVR · go live", run: () => setWindow(null) },
      {
        id: "replay",
        label: "DVR · replay last hour",
        run: () =>
          setWindow({
            from: Date.now() - 60 * 60_000,
            to: Date.now(),
          }),
      },
      {
        id: "flyTopEvent",
        label: top ? `Fly to: ${top.title}` : "Fly to top event",
        hint: top?.severity,
        run: () => {
          if (top?.geo) requestFly({ lat: top.geo.lat, lon: top.geo.lon, zoom: 7 });
        },
      },
      {
        id: "highOnly",
        label: "Filter: only high+extreme",
        run: () => {
          clearFilters();
          toggleSev("high");
          toggleSev("extreme");
        },
      },
      { id: "clearFilter", label: "Filter: clear all", run: clearFilters },
    ];
  }, [
    events,
    setView,
    setNight,
    setAnalyst,
    setOverseer,
    setWindow,
    requestFly,
    clearFilters,
    toggleSev,
    router,
  ]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return cmds;
    return cmds.filter((c) => c.label.toLowerCase().includes(t));
  }, [cmds, q]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 p-4 pt-20"
      onClick={() => setOpen(false)}
    >
      <div
        className="panel w-[520px] max-w-full p-2"
        onClick={(e) => e.stopPropagation()}
        data-agent="command-palette"
      >
        <input
          autoFocus
          className="input"
          placeholder="Type a command — e.g. 'replay last hour', 'fly to top event', 'rules'…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              filtered[0]?.run();
              setOpen(false);
            }
          }}
        />
        <ul className="mt-2 max-h-[40vh] overflow-auto">
          {filtered.map((c) => (
            <li key={c.id}>
              <button
                className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-white/10"
                onClick={() => {
                  c.run();
                  setOpen(false);
                }}
              >
                <span>{c.label}</span>
                {c.hint && <span className="text-[10px] text-white/40">{c.hint}</span>}
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-2 py-2 text-xs text-white/50">No matching command</li>
          )}
        </ul>
        <div className="mt-1 text-right text-[10px] text-white/40">⌘K to toggle</div>
      </div>
    </div>
  );
}
