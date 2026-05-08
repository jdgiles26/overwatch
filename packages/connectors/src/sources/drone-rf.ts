import { z } from "zod";
import type { GeoPoint } from "@overwatch/schemas";
import { defineConnector } from "../types.js";
import { fetchJson, sleep } from "../util.js";

const Cfg = z.object({
  mode: z.enum(["mqtt", "http"]).default("mqtt"),
  brokerUrl: z.string().default("ws://localhost:9001"),
  topic: z.string().default("overwatch/drone/#"),
  mqttUsername: z.string().default(""),
  mqttPassword: z.string().default(""),
  endpointUrl: z.string().default("http://localhost:8080/detections"),
  pollIntervalMs: z.number().default(1000),
  nodeId: z.string().default("node-1"),
  nodeLat: z.number().default(0),
  nodeLon: z.number().default(0),
  nodeAltM: z.number().default(0),
  defaultRangeM: z.number().default(150),
  severityThresholdRssi: z.number().default(-80),
});

type DetectionFrame = {
  ts: string;
  nodeId: string;
  doppler: number[];
  rssi: number;
  rangeM?: number;
  rangeErrorM?: number;
  csi?: number[];
};

export function deriveRangeError(explicit: number | undefined, rangeM: number): number {
  return explicit !== undefined ? explicit : Math.round(rangeM * 0.2);
}

export function parseFrame(
  frame: unknown,
  nodeGeo: { lat: number; lon: number; alt?: number },
  nodeId: string,
  severityThresholdRssi: number,
) {
  if (!frame || typeof frame !== "object") return null;
  const f = frame as Record<string, unknown>;
  if (!f.nodeId || typeof f.nodeId !== "string") return null;
  if (!f.ts || typeof f.ts !== "string") return null;

  const rangeM = typeof f.rangeM === "number" ? f.rangeM : 0;
  const rssi = typeof f.rssi === "number" ? f.rssi : -100;
  const severity = rssi < severityThresholdRssi ? "low" : "moderate";

  // If the frame carries explicit target coordinates (advanced node with
  // on-board localisation), use those instead of the node's fixed position.
  const geo: GeoPoint = {
    lat: typeof f.lat === "number" ? f.lat : nodeGeo.lat,
    lon: typeof f.lon === "number" ? f.lon : nodeGeo.lon,
  };
  const altVal = typeof f.alt === "number" ? f.alt : nodeGeo.alt;
  if (altVal !== undefined) geo.alt = altVal;

  return {
    id: `drone-${f.nodeId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    category: "drone" as const,
    severity: severity as "low" | "moderate",
    title: `Drone detection — node ${f.nodeId}`,
    summary: `rssi ${rssi} dBm, range ~${rangeM}m`,
    occurredAt: f.ts,
    geo,
    payload: {
      nodeId: f.nodeId,
      doppler: Array.isArray(f.doppler) ? f.doppler : [],
      rssi,
      rangeM,
      rangeErrorM: deriveRangeError(
        typeof f.rangeErrorM === "number" ? f.rangeErrorM : undefined,
        rangeM,
      ),
      csi: Array.isArray(f.csi) ? f.csi : undefined,
    },
  };
}

export const droneRf = defineConnector<z.infer<typeof Cfg>>({
  id: "drone-rf",
  label: "Drone RF Sensor (ISAC/Bistatic)",
  description:
    "Passive RF airspace detection via bistatic CSI/Doppler sensing nodes. Supports MQTT subscribe or HTTP poll. Based on SISO bistatic ISAC sensing.",
  category: "drone",
  authKind: "mqtt",
  freeTier: true,
  configSchema: Cfg,
  defaultConfig: {
    mode: "mqtt",
    brokerUrl: "ws://localhost:9001",
    topic: "overwatch/drone/#",
    mqttUsername: "",
    mqttPassword: "",
    endpointUrl: "http://localhost:8080/detections",
    pollIntervalMs: 1000,
    nodeId: "node-1",
    nodeLat: 0,
    nodeLon: 0,
    nodeAltM: 0,
    defaultRangeM: 150,
    severityThresholdRssi: -80,
  },
  async run(ctx) {
    const cfg = ctx.config;
    const nodeGeo = { lat: cfg.nodeLat, lon: cfg.nodeLon, alt: cfg.nodeAltM };

    const emit = (frame: unknown) => {
      const ev = parseFrame(frame, nodeGeo, cfg.nodeId, cfg.severityThresholdRssi);
      if (!ev) return;
      ctx.emit(ev);
    };

    if (cfg.mode === "mqtt") {
      const mqtt = await import("mqtt");
      await new Promise<void>((resolve) => {
        const client = mqtt.connect(cfg.brokerUrl, {
          username: cfg.mqttUsername || undefined,
          password: cfg.mqttPassword || undefined,
          reconnectPeriod: 3000,
          rejectUnauthorized: false,
        });
        const cleanup = () => {
          try { client.end(true); } catch { /* ignore */ }
          resolve();
        };
        ctx.signal.addEventListener("abort", cleanup);
        client.on("connect", () => {
          ctx.log(`drone-rf connected to ${cfg.brokerUrl}, subscribing to ${cfg.topic}`);
          client.subscribe(cfg.topic);
        });
        client.on("message", (_topic, payload) => {
          try { emit(JSON.parse(payload.toString())); } catch { /* ignore */ }
        });
        client.on("error", (e) => ctx.log("mqtt error", e.message));
      });
    } else {
      while (!ctx.signal.aborted) {
        try {
          const data = await fetchJson(cfg.endpointUrl, { signal: ctx.signal });
          const frames = Array.isArray(data) ? data : [data];
          for (const f of frames) emit(f);
        } catch {
          /* ignore network errors; retry next poll */
        }
        await sleep(cfg.pollIntervalMs, ctx.signal);
      }
    }
  },
});
