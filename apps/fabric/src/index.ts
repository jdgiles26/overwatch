import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { ALL_CONNECTORS, getConnectorById, getWebhookRouter, toDefinition } from "@overwatch/connectors";
import {
  db,
  deleteCamera,
  deleteLocation,
  eventsByBbox,
  listCameras,
  listLocations,
  recentEvents,
  upsertCamera,
  upsertLocation,
} from "./db.js";
import { orchestrator } from "./orchestrator.js";
import { computePIR, computeThreatcon } from "./threatcon.js";
import type { ServerToClient } from "@overwatch/schemas";

const PORT = Number(process.env.FABRIC_PORT ?? 4311);
const app = Fastify({ logger: { level: "info" } });

await app.register(cors, { origin: true });
await app.register(websocket);

const clients = new Set<any>();

app.get("/health", async () => ({ ok: true, time: new Date().toISOString() }));

app.get("/api/connectors/catalog", async () => {
  return ALL_CONNECTORS.map((c) => ({
    ...toDefinition(c),
    configSchema: undefined,
    defaults: c.defaultConfig,
    configFields: extractFields(c),
  }));
});

function extractFields(c: any): any[] {
  const shape = c.configSchema?._def?.shape?.();
  if (!shape) return [];
  return Object.entries<any>(shape).map(([key, val]) => {
    let kind = "string";
    let options: string[] | undefined;
    let defaultVal = c.defaultConfig?.[key];
    let zt = val;
    if (zt?._def?.typeName === "ZodDefault") {
      if (defaultVal === undefined) defaultVal = zt._def.defaultValue();
      zt = zt._def.innerType;
    }
    const tn = zt?._def?.typeName;
    if (tn === "ZodString") kind = "string";
    else if (tn === "ZodNumber") kind = "number";
    else if (tn === "ZodBoolean") kind = "boolean";
    else if (tn === "ZodEnum") {
      kind = "enum";
      options = zt._def.values;
    } else if (tn === "ZodArray") kind = "array";
    else if (tn === "ZodObject") kind = "object";
    else if (tn === "ZodRecord") kind = "record";
    else if (tn === "ZodTuple") kind = "tuple";
    return { key, kind, options, default: defaultVal, description: zt?._def?.description };
  });
}

app.get("/api/connectors/status", async () => orchestrator.allStatus());

app.post("/api/connectors", async (req, reply) => {
  const body = req.body as any;
  if (!body?.connectorId) return reply.status(400).send({ error: "connectorId required" });
  const connector = getConnectorById(body.connectorId);
  if (!connector) return reply.status(404).send({ error: "unknown connector" });
  const cfg = { ...connector.defaultConfig, ...(body.config ?? {}) };
  const id = orchestrator.addInstance(body.connectorId, body.label ?? connector.label, cfg, body.enabled ?? true);
  return { id };
});

app.patch("/api/connectors/:id", async (req, reply) => {
  const id = (req.params as any).id;
  try {
    orchestrator.updateInstance(id, req.body as any);
    return { ok: true };
  } catch (e: any) {
    return reply.status(400).send({ error: e.message });
  }
});

app.delete("/api/connectors/:id", async (req) => {
  orchestrator.removeInstance((req.params as any).id);
  return { ok: true };
});

app.get("/api/events", async (req) => {
  const q = req.query as any;
  if (q.bbox) {
    const parts = String(q.bbox).split(",").map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const [minLon, minLat, maxLon, maxLat] = parts as [number, number, number, number];
      return eventsByBbox(minLon, minLat, maxLon, maxLat, Number(q.limit ?? 2000));
    }
  }
  return recentEvents(Number(q.limit ?? 500));
});

app.get("/api/locations", async () => listLocations());
app.post("/api/locations", async (req) => {
  upsertLocation(req.body);
  return { ok: true };
});
app.delete("/api/locations/:id", async (req) => {
  deleteLocation((req.params as any).id);
  return { ok: true };
});

app.get("/api/cameras", async () =>
  listCameras().map((c) => ({ ...c, detectors: safeParse(c.detectors) })),
);
app.post("/api/cameras", async (req) => {
  upsertCamera(req.body);
  return { ok: true };
});
app.delete("/api/cameras/:id", async (req) => {
  deleteCamera((req.params as any).id);
  return { ok: true };
});

app.get("/api/threatcon", async () => {
  const events = recentEvents(1000);
  const locations = listLocations().map((l: any) => ({
    id: l.id,
    label: l.label,
    geo: { lat: l.lat, lon: l.lon },
    radiusKm: l.radius_km,
    kind: l.kind,
  }));
  return {
    threatcon: computeThreatcon(events, locations),
    pir: computePIR(events, locations),
  };
});

app.post("/ingest/:key", async (req, reply) => {
  const key = (req.params as any).key;
  const handler = getWebhookRouter().get(key);
  if (!handler) return reply.status(404).send({ error: "no webhook handler for key" });
  handler(req.body);
  return { ok: true };
});

app.post("/api/cv-event", async (req, reply) => {
  const body = req.body as any;
  if (!body?.title) return reply.status(400).send({ error: "title required" });
  const full = {
    id: body.id ?? `cv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    source: body.source ?? "browser-cv",
    connectorId: "browser-cv",
    category: "cv" as const,
    severity: (body.severity as any) ?? "moderate",
    title: body.title,
    summary: body.summary,
    occurredAt: body.occurredAt ?? new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    geo: body.geo,
    icon: body.icon ?? "eye",
    payload: body.payload,
  };
  const { persistEvent } = await import("./db.js");
  persistEvent(full);
  broadcast({ type: "event", data: full });
  return { ok: true };
});

app.get("/ws", { websocket: true }, (socket) => {
  clients.add(socket);
  socket.send(
    JSON.stringify({ type: "hello", data: { sessionId: Math.random().toString(36).slice(2), ts: new Date().toISOString() } }),
  );
  socket.send(
    JSON.stringify({ type: "snapshot", data: { events: recentEvents(200) } }),
  );
  socket.send(JSON.stringify({ type: "status", data: orchestrator.allStatus() }));
  socket.on("close", () => clients.delete(socket));
  socket.on("message", () => {
    /* subscriptions handled by bbox on GET */
  });
});

function broadcast(msg: ServerToClient) {
  const s = JSON.stringify(msg);
  for (const c of clients) {
    try {
      c.send(s);
    } catch {
      /* ignore */
    }
  }
}

orchestrator.on("event", (ev) => broadcast({ type: "event", data: ev }));
orchestrator.on("status", (st) => broadcast({ type: "status", data: st }));

let threatTimer: NodeJS.Timeout | null = null;
function startThreatLoop() {
  threatTimer = setInterval(() => {
    const events = recentEvents(1000);
    const locations = listLocations().map((l: any) => ({
      id: l.id,
      label: l.label,
      geo: { lat: l.lat, lon: l.lon },
      radiusKm: l.radius_km,
      kind: l.kind,
    }));
    broadcast({ type: "threatcon", data: computeThreatcon(events, locations) });
    broadcast({ type: "pir", data: computePIR(events, locations) });
  }, 15_000);
}

function safeParse(s: any) {
  if (!s) return [];
  try {
    return typeof s === "string" ? JSON.parse(s) : s;
  } catch {
    return [];
  }
}

await orchestrator.start();
startThreatLoop();

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`fabric listening on ${PORT}`));

process.on("SIGINT", () => {
  if (threatTimer) clearInterval(threatTimer);
  orchestrator.stop();
  db.close();
  app.close().then(() => process.exit(0));
});
