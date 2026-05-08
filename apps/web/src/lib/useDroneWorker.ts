"use client";
import { useEffect, useRef } from "react";
import { useStore } from "./store";

export function useDroneWorker() {
  const droneTracks = useStore((s) => s.droneTracks);
  const locations = useStore((s) => s.locations);
  const workerRef = useRef<Worker | null>(null);

  // Spawn worker once on mount
  useEffect(() => {
    if (typeof Worker === "undefined") return;
    const worker = new Worker(
      new URL("../components/droneWorker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (ev) => {
      if (ev.data?.type === "classification") {
        const c = ev.data.data;
        // setDroneClassification is stable (Zustand action ref doesn't change)
        useStore.getState().setDroneClassification(c.trackId, c);
      }
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // Post classify messages whenever tracks change (worker debounces internally)
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;
    for (const track of droneTracks) {
      if (track.state === "expired") continue;
      worker.postMessage({ type: "classify", track, locations });
    }
  }, [droneTracks, locations]);
}
