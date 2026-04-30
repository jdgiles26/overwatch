"use client";
import dynamic from "next/dynamic";
import { useStore } from "@/lib/store";

const Map3D = dynamic(() => import("./Map3D").then((m) => m.Map3D), {
  ssr: false,
  loading: () => <MapLoading label="Loading 3D globe…" />,
});
const Map2D = dynamic(() => import("./Map2D").then((m) => m.Map2D), {
  ssr: false,
  loading: () => <MapLoading label="Loading map…" />,
});

export function MapView() {
  const view = useStore((s) => s.view);

  if (view === "split") {
    return (
      <div className="grid h-full min-h-0 w-full grid-cols-2 gap-1">
        <div className="relative h-full w-full overflow-hidden rounded-md">
          <Map3D />
        </div>
        <div className="relative h-full w-full overflow-hidden rounded-md">
          <Map2D />
        </div>
      </div>
    );
  }
  return (
    <div className="relative h-full w-full overflow-hidden">
      {view === "map3d" ? <Map3D /> : <Map2D />}
    </div>
  );
}

function MapLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-ink-900 text-xs text-white/50">
      <div className="flex items-center gap-2">
        <span className="pulse-dot" />
        {label}
      </div>
    </div>
  );
}
