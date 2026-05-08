"use client";
import { useEffect } from "react";
import { TopBar } from "@/components/TopBar";
import { IntelFeed } from "@/components/IntelFeed";
import { MapView } from "@/components/MapView";
import { AssessmentPanel } from "@/components/AssessmentPanel";
import { CameraStrip } from "@/components/CameraStrip";
import { AnalystPanel } from "@/components/AnalystPanel";
import { OverseerPanel } from "@/components/OverseerPanel";
import { EventDetail } from "@/components/EventDetail";
import { DroneDetailPanel } from "@/components/DroneDetailPanel";
import { TimeScrubber } from "@/components/TimeScrubber";
import { CommandPalette } from "@/components/CommandPalette";
import { useFabricSocket } from "@/lib/ws";
import { useDroneWorker } from "@/lib/useDroneWorker";
import { useTopicWorker } from "@/lib/useTopicWorker";
import { useStore } from "@/lib/store";
import { apiGet } from "@/lib/api";

export default function HomePage() {
  useFabricSocket();
  useDroneWorker();
  useTopicWorker();
  const setLocations = useStore((s) => s.setLocations);
  const night = useStore((s) => s.nightVision);

  useEffect(() => {
    apiGet<any[]>("/api/locations")
      .then((arr) =>
        setLocations(
          arr.map((l: any) => ({
            id: l.id,
            label: l.label,
            geo: { lat: l.lat, lon: l.lon },
            radiusKm: l.radius_km ?? 25,
            kind: l.kind ?? "home",
          })),
        ),
      )
      .catch(() => {
        /* fabric not up yet */
      });
  }, [setLocations]);

  return (
    <div className={`flex h-screen min-h-screen flex-col bg-ink-950 ${night ? "nightvision" : ""}`}>
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <IntelFeed />
        <main className="relative flex min-h-0 flex-1 flex-col">
          <div className="relative flex-1 tactical-grid">
            <MapView />
            <EventDetail />
            <DroneDetailPanel />
            <TimeScrubber />
            <AnalystPanel />
            <OverseerPanel />
          </div>
          <CameraStrip />
        </main>
        <AssessmentPanel />
      </div>
      <CommandPalette />
    </div>
  );
}
