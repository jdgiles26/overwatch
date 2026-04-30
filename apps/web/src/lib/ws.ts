"use client";
import { useEffect } from "react";
import { useStore } from "./store";

export function useFabricSocket() {
  const addEvent = useStore((s) => s.addEvent);
  const setEvents = useStore((s) => s.setEvents);
  const setStatus = useStore((s) => s.setStatus);
  const setThreatCon = useStore((s) => s.setThreatCon);
  const setPIR = useStore((s) => s.setPIR);
  const setWsConnected = useStore((s) => s.setWsConnected);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 1000;

    function connect() {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      // The fabric WS is served directly from fabric service, not via Next.js rewrites.
      const wsBase = process.env.NEXT_PUBLIC_FABRIC_WS ?? `${proto}://${location.hostname}:4311`;
      ws = new WebSocket(`${wsBase}/ws`);
      ws.onopen = () => {
        setWsConnected(true);
        retry = 1000;
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "event") addEvent(msg.data);
          else if (msg.type === "snapshot") setEvents(msg.data.events);
          else if (msg.type === "status") setStatus(msg.data);
          else if (msg.type === "threatcon") setThreatCon(msg.data);
          else if (msg.type === "pir") setPIR(msg.data);
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        setWsConnected(false);
        if (!closed) {
          setTimeout(connect, Math.min(retry, 15_000));
          retry *= 2;
        }
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
      };
    }

    connect();
    return () => {
      closed = true;
      ws?.close();
    };
  }, [addEvent, setEvents, setStatus, setThreatCon, setPIR, setWsConnected]);
}
