"use client";
import { useEffect, useRef } from "react";
import { useStore } from "./store";

export function useTopicWorker() {
  const events = useStore((s) => s.events);
  const eventTopics = useStore((s) => s.eventTopics);
  const setEventTopics = useStore((s) => s.setEventTopics);
  const workerRef = useRef<Worker | null>(null);
  const classifiedRef = useRef(new Set<string>());

  useEffect(() => {
    if (typeof Worker === "undefined") return;
    const worker = new Worker(
      new URL("../components/topicWorker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (ev) => {
      const msg = ev.data;
      if (msg.type === "topics") {
        setEventTopics(msg.eventId, msg.topics);
      }
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Submit newly arrived events that haven't been classified yet
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;
    for (const ev of events) {
      if (classifiedRef.current.has(ev.id)) continue;
      // Skip already-classified or category tags that don't need NLI enrichment
      if (ev.category === "cv" || ev.category === "drone") continue;
      classifiedRef.current.add(ev.id);
      const text = [ev.title, ev.summary ?? ""].filter(Boolean).join(". ");
      worker.postMessage({ type: "classify", eventId: ev.id, text });
    }
  }, [events]);

  // Sync classified set with store on init so reloads don't re-classify
  useEffect(() => {
    for (const id of Object.keys(eventTopics)) {
      classifiedRef.current.add(id);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
