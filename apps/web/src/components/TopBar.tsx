"use client";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import {
  Eye,
  Globe2,
  Map as MapIcon,
  MessageSquareMore,
  Radar,
  Radio,
  ShieldAlert,
  Zap,
} from "lucide-react";

export function TopBar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const night = useStore((s) => s.nightVision);
  const setNight = useStore((s) => s.setNightVision);
  const setAnalyst = useStore((s) => s.setAnalystOpen);
  const setOverseer = useStore((s) => s.setOverseerOpen);
  const analystOpen = useStore((s) => s.analystOpen);
  const overseerOpen = useStore((s) => s.overseerOpen);
  const wsConnected = useStore((s) => s.wsConnected);
  const status = useStore((s) => s.status);
  const threatcon = useStore((s) => s.threatcon);

  const active = status.filter((s) => s.enabled && s.connected).length;

  return (
    <header
      className="flex h-12 items-center gap-3 border-b border-white/5 bg-ink-900/70 px-3 backdrop-blur"
      data-agent="topbar"
    >
      <div className="flex items-center gap-2">
        <div className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-accent-500/20">
          <Radar className="h-4 w-4 text-accent-400" />
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent-400 animate-ping" />
        </div>
        <div className="font-semibold tracking-tight">OverWatch</div>
        <span className="badge ml-2">V0.1</span>
      </div>

      <div className="mx-4 flex items-center gap-1 text-xs">
        <ViewButton
          active={view === "map3d"}
          onClick={() => setView("map3d")}
          icon={<Globe2 className="h-4 w-4" />}
          label="3D Globe"
          tag="view-3d"
        />
        <ViewButton
          active={view === "map2d"}
          onClick={() => setView("map2d")}
          icon={<MapIcon className="h-4 w-4" />}
          label="2D Map"
          tag="view-2d"
        />
        <ViewButton
          active={view === "split"}
          onClick={() => setView("split")}
          icon={<Zap className="h-4 w-4" />}
          label="Split"
          tag="view-split"
        />
      </div>

      <div className="ml-auto flex items-center gap-2 text-xs">
        <span
          className={cn(
            "badge gap-2",
            wsConnected ? "text-accent-400" : "text-white/40",
          )}
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              wsConnected ? "bg-accent-400 animate-pulse" : "bg-white/30",
            )}
          />
          FABRIC {wsConnected ? "LIVE" : "OFFLINE"}
        </span>
        <span className="badge gap-1">
          <Radio className="h-3 w-3" /> {active} live sources
        </span>
        {threatcon && (
          <span
            className={cn(
              "badge gap-1 font-semibold",
              threatcon.level === "nominal" && "text-threat-nominal",
              threatcon.level === "guarded" && "text-threat-guarded",
              threatcon.level === "elevated" && "text-threat-elevated",
              threatcon.level === "high" && "text-threat-high",
              threatcon.level === "critical" && "text-threat-critical",
            )}
          >
            <ShieldAlert className="h-3 w-3" />
            THREATCON {threatcon.score.toFixed(1)} • {threatcon.level.toUpperCase()}
          </span>
        )}
        <button
          className={cn(
            "badge gap-1 hover:bg-white/10",
            night && "text-nightvision bg-nightvision/20",
          )}
          onClick={() => setNight(!night)}
          data-agent="night-toggle"
        >
          <Eye className="h-3 w-3" /> Night Vision
        </button>
        <button
          className={cn(
            "badge gap-1 hover:bg-white/10",
            analystOpen && "text-accent-400 bg-accent-500/20",
          )}
          onClick={() => setAnalyst(!analystOpen)}
          data-agent="analyst-toggle"
        >
          <MessageSquareMore className="h-3 w-3" /> Analyst
        </button>
        <button
          className={cn(
            "badge gap-1 hover:bg-white/10",
            overseerOpen && "text-accent-400 bg-accent-500/20",
          )}
          onClick={() => setOverseer(!overseerOpen)}
          data-agent="overseer-toggle"
        >
          <Eye className="h-3 w-3" /> Overseer
        </button>
        <a
          href="/connectors"
          className="badge hover:bg-white/10"
          data-agent="nav-connectors"
        >
          Connectors
        </a>
      </div>
    </header>
  );
}

function ViewButton(props: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  tag: string;
}) {
  return (
    <button
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs",
        props.active ? "bg-accent-500/20 text-accent-400" : "text-white/60 hover:bg-white/5",
      )}
      onClick={props.onClick}
      data-agent={props.tag}
    >
      {props.icon}
      {props.label}
    </button>
  );
}
