"use client";
import { useEffect } from "react";
import { useStore } from "./store";
import { playSound, showDesktopNotification } from "./notify";

export function useFabricSocket() {
  const addEvent = useStore((s) => s.addEvent);
  const setEvents = useStore((s) => s.setEvents);
  const setStatus = useStore((s) => s.setStatus);
  const setThreatCon = useStore((s) => s.setThreatCon);
  const setPIR = useStore((s) => s.setPIR);
  const setWsConnected = useStore((s) => s.setWsConnected);
  const setRules = useStore((s) => s.setRules);
  const pushFiring = useStore((s) => s.pushFiring);
  const pushDroneTrack = useStore((s) => s.pushDroneTrack);
  const setDroneClassification = useStore((s) => s.setDroneClassification);
  const setFollowDrone = useStore((s) => s.setFollowDrone);

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
          else if (msg.type === "rules") setRules(msg.data);
          else if (msg.type === "drone-track") {
            pushDroneTrack(msg.data);
            if (!useStore.getState().followDroneId && msg.data.severity === "extreme") {
              setFollowDrone(msg.data.id);
            }
          }
          else if (msg.type === "drone-classification") {
            setDroneClassification(msg.data.trackId, msg.data);
          }
          else if (msg.type === "alert") {
            const f = msg.data;
            pushFiring(f);
            const rule = useStore.getState().rules.find((r) => r.id === f.ruleId);
            if (rule?.notify?.sound) playSound(rule.notify.soundKind ?? "chime");
            if (rule?.notify?.desktop) {
              const ev = f.event ?? {};
              const where = ev.geo
                ? ` @ ${ev.geo.lat.toFixed(2)},${ev.geo.lon.toFixed(2)}`
                : "";
              showDesktopNotification(
                `${f.ruleLabel}`,
                `${ev.severity?.toUpperCase?.() ?? ""} ${ev.title ?? "alert"}${where}`,
                { tag: f.ruleId },
              );
            }
          }
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
  }, [
    addEvent,
    setEvents,
    setStatus,
    setThreatCon,
    setPIR,
    setWsConnected,
    setRules,
    pushFiring,
    pushDroneTrack,
    setDroneClassification,
    setFollowDrone,
  ]);
}
