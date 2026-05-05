import { z } from "zod";

export const GeoPoint = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  alt: z.number().optional(),
});
export type GeoPoint = z.infer<typeof GeoPoint>;

export const Severity = z.enum(["info", "low", "moderate", "high", "extreme"]);
export type Severity = z.infer<typeof Severity>;

export const EventCategory = z.enum([
  "weather",
  "seismic",
  "air",
  "transport",
  "power",
  "water",
  "news",
  "iot",
  "cv",
  "space",
  "finance",
  "social",
  "fire",
  "lightning",
  "health",
  "other",
]);
export type EventCategory = z.infer<typeof EventCategory>;

export const IngestEvent = z.object({
  id: z.string(),
  source: z.string(),
  connectorId: z.string(),
  category: EventCategory,
  severity: Severity.default("info"),
  title: z.string(),
  summary: z.string().optional(),
  occurredAt: z.string().datetime(),
  receivedAt: z.string().datetime(),
  geo: GeoPoint.optional(),
  geoMentioned: z.string().optional(),
  payload: z.record(z.any()).optional(),
  icon: z.string().optional(),
  url: z.string().url().optional(),
});
export type IngestEvent = z.infer<typeof IngestEvent>;

export const ConnectorAuthKind = z.enum(["none", "api-key", "oauth", "mqtt", "webhook", "rtsp"]);
export type ConnectorAuthKind = z.infer<typeof ConnectorAuthKind>;

export const ConnectorStatus = z.object({
  id: z.string(),
  label: z.string(),
  category: EventCategory,
  authKind: ConnectorAuthKind,
  enabled: z.boolean(),
  connected: z.boolean(),
  lastEventAt: z.string().datetime().optional(),
  eventsLastMinute: z.number().default(0),
  eventsLastHour: z.number().default(0),
  errors: z.array(z.string()).default([]),
  configured: z.boolean().default(false),
});
export type ConnectorStatus = z.infer<typeof ConnectorStatus>;

export const ConnectorDefinition = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  category: EventCategory,
  authKind: ConnectorAuthKind,
  configSchema: z.any(),
  homepageUrl: z.string().optional(),
  docsUrl: z.string().optional(),
  freeTier: z.boolean().default(true),
});
export type ConnectorDefinition = z.infer<typeof ConnectorDefinition>;

export const Location = z.object({
  id: z.string(),
  label: z.string(),
  geo: GeoPoint,
  radiusKm: z.number().default(25),
  kind: z.enum(["home", "work", "school", "family", "other"]).default("home"),
});
export type Location = z.infer<typeof Location>;

export const ThreatCon = z.object({
  score: z.number().min(0).max(10),
  level: z.enum(["nominal", "guarded", "elevated", "high", "critical"]),
  reasons: z.array(z.string()),
  computedAt: z.string().datetime(),
});
export type ThreatCon = z.infer<typeof ThreatCon>;

export const PIR = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.enum(["yes", "no", "unknown"]),
  detail: z.string().optional(),
  evidenceIds: z.array(z.string()).default([]),
});
export type PIR = z.infer<typeof PIR>;

export const CameraFeed = z.object({
  id: z.string(),
  label: z.string(),
  source: z.string(),
  kind: z.enum(["rtsp", "hls", "mjpeg", "webcam", "youtube"]),
  geo: GeoPoint.optional(),
  whepUrl: z.string().optional(),
  hlsUrl: z.string().optional(),
  detectors: z.array(z.enum(["motion", "person", "vehicle", "fire", "plate"])).default([]),
});
export type CameraFeed = z.infer<typeof CameraFeed>;

export const AlertRuleCondition = z.object({
  categories: z.array(EventCategory).optional(),
  minSeverity: Severity.optional(),
  keywords: z.array(z.string()).default([]),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  nearLocationId: z.string().optional(),
  nearKm: z.number().optional(),
  rateLimitMs: z.number().default(60_000),
});
export type AlertRuleCondition = z.infer<typeof AlertRuleCondition>;

export const AlertRule = z.object({
  id: z.string(),
  label: z.string(),
  enabled: z.boolean().default(true),
  notify: z.object({
    desktop: z.boolean().default(true),
    sound: z.boolean().default(true),
    soundKind: z.enum(["chime", "siren", "tone", "none"]).default("chime"),
    severityFloor: Severity.default("moderate"),
  }),
  condition: AlertRuleCondition,
});
export type AlertRule = z.infer<typeof AlertRule>;

export const AlertFiring = z.object({
  id: z.string(),
  ruleId: z.string(),
  ruleLabel: z.string(),
  event: IngestEvent,
  firedAt: z.string().datetime(),
  reason: z.string(),
});
export type AlertFiring = z.infer<typeof AlertFiring>;

export const ServerToClient = z.discriminatedUnion("type", [
  z.object({ type: z.literal("event"), data: IngestEvent }),
  z.object({ type: z.literal("status"), data: z.array(ConnectorStatus) }),
  z.object({ type: z.literal("threatcon"), data: ThreatCon }),
  z.object({ type: z.literal("pir"), data: z.array(PIR) }),
  z.object({ type: z.literal("hello"), data: z.object({ sessionId: z.string(), ts: z.string() }) }),
  z.object({ type: z.literal("snapshot"), data: z.object({ events: z.array(IngestEvent) }) }),
  z.object({ type: z.literal("alert"), data: AlertFiring }),
  z.object({ type: z.literal("rules"), data: z.array(AlertRule) }),
]);
export type ServerToClient = z.infer<typeof ServerToClient>;

export const ClientToServer = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subscribe"),
    data: z
      .object({
        categories: z.array(EventCategory).optional(),
        bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
      })
      .default({}),
  }),
  z.object({ type: z.literal("ping"), data: z.object({}).default({}) }),
]);
export type ClientToServer = z.infer<typeof ClientToServer>;
