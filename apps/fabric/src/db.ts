import Database, { type Database as BetterSqliteDatabase } from "better-sqlite3";
import * as fs from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import crypto from "node:crypto";
import type { IngestEvent } from "@overwatch/schemas";

export type InstanceConfig = {
  id: string;
  connectorId: string;
  label: string;
  enabled: number;
  config: string; // encrypted json
};

const KEY_PATH = process.env.OVERWATCH_KEY_PATH ?? "./data/key.bin";
const DB_PATH = process.env.OVERWATCH_DB ?? "./data/overwatch.db";

function getOrMakeKey(): Buffer {
  try {
    return fs.readFileSync(KEY_PATH);
  } catch {
    mkdirSync(dirname(KEY_PATH), { recursive: true });
    const k = crypto.randomBytes(32);
    fs.writeFileSync(KEY_PATH, k, { mode: 0o600 });
    return k;
  }
}

const KEY = getOrMakeKey();

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(b64: string): string {
  const buf = Buffer.from(b64, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db: BetterSqliteDatabase = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    source TEXT,
    connector_id TEXT,
    category TEXT,
    severity TEXT,
    title TEXT,
    summary TEXT,
    occurred_at TEXT,
    received_at TEXT,
    lat REAL, lon REAL, alt REAL,
    geo_mentioned TEXT,
    url TEXT,
    icon TEXT,
    payload TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_events_received ON events(received_at DESC);
  CREATE INDEX IF NOT EXISTS idx_events_category ON events(category);
  CREATE INDEX IF NOT EXISTS idx_events_severity ON events(severity);

  CREATE TABLE IF NOT EXISTS connector_instances (
    id TEXT PRIMARY KEY,
    connector_id TEXT,
    label TEXT,
    enabled INTEGER DEFAULT 1,
    config TEXT
  );

  CREATE TABLE IF NOT EXISTS cameras (
    id TEXT PRIMARY KEY,
    label TEXT,
    source TEXT,
    kind TEXT,
    lat REAL, lon REAL,
    whep_url TEXT,
    hls_url TEXT,
    detectors TEXT
  );

  CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    label TEXT,
    lat REAL, lon REAL,
    radius_km REAL,
    kind TEXT
  );

  CREATE TABLE IF NOT EXISTS alert_rules (
    id TEXT PRIMARY KEY,
    label TEXT,
    enabled INTEGER DEFAULT 1,
    notify TEXT,
    condition TEXT
  );

  CREATE TABLE IF NOT EXISTS alert_firings (
    id TEXT PRIMARY KEY,
    rule_id TEXT,
    rule_label TEXT,
    event_id TEXT,
    fired_at TEXT,
    reason TEXT,
    payload TEXT
  );

  CREATE TABLE IF NOT EXISTS aois (
    id TEXT PRIMARY KEY,
    label TEXT,
    polygon TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_firings_at ON alert_firings(fired_at DESC);
`);

const insertEvent = db.prepare(`
  INSERT OR REPLACE INTO events
  (id, source, connector_id, category, severity, title, summary, occurred_at, received_at, lat, lon, alt, geo_mentioned, url, icon, payload)
  VALUES (@id,@source,@connectorId,@category,@severity,@title,@summary,@occurredAt,@receivedAt,@lat,@lon,@alt,@geoMentioned,@url,@icon,@payload)
`);

export function persistEvent(e: IngestEvent) {
  insertEvent.run({
    id: e.id,
    source: e.source,
    connectorId: e.connectorId,
    category: e.category,
    severity: e.severity,
    title: e.title,
    summary: e.summary ?? "",
    occurredAt: e.occurredAt,
    receivedAt: e.receivedAt,
    lat: e.geo?.lat ?? null,
    lon: e.geo?.lon ?? null,
    alt: e.geo?.alt ?? null,
    geoMentioned: e.geoMentioned ?? null,
    url: e.url ?? null,
    icon: e.icon ?? null,
    payload: e.payload ? JSON.stringify(e.payload) : null,
  });
}

export function recentEvents(limit = 500): IngestEvent[] {
  const rows = db
    .prepare(
      `SELECT * FROM events ORDER BY received_at DESC LIMIT ?`,
    )
    .all(limit) as any[];
  return rows.map(rowToEvent);
}

export function eventsByBbox(
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
  limit = 2000,
): IngestEvent[] {
  const rows = db
    .prepare(
      `SELECT * FROM events WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? ORDER BY received_at DESC LIMIT ?`,
    )
    .all(minLat, maxLat, minLon, maxLon, limit) as any[];
  return rows.map(rowToEvent);
}

export function rowToEvent(r: any): IngestEvent {
  return {
    id: r.id,
    source: r.source,
    connectorId: r.connector_id,
    category: r.category,
    severity: r.severity ?? "info",
    title: r.title ?? "",
    summary: r.summary ?? undefined,
    occurredAt: r.occurred_at,
    receivedAt: r.received_at,
    geo:
      r.lat != null && r.lon != null
        ? { lat: r.lat, lon: r.lon, alt: r.alt ?? undefined }
        : undefined,
    geoMentioned: r.geo_mentioned ?? undefined,
    url: r.url ?? undefined,
    icon: r.icon ?? undefined,
    payload: r.payload ? JSON.parse(r.payload) : undefined,
  };
}

export function listInstances(): InstanceConfig[] {
  return db.prepare(`SELECT * FROM connector_instances`).all() as any[];
}

export function upsertInstance(i: InstanceConfig) {
  db.prepare(
    `INSERT OR REPLACE INTO connector_instances (id, connector_id, label, enabled, config) VALUES (?,?,?,?,?)`,
  ).run(i.id, i.connectorId, i.label, i.enabled, i.config);
}

export function deleteInstance(id: string) {
  db.prepare(`DELETE FROM connector_instances WHERE id = ?`).run(id);
}

export function listCameras(): any[] {
  return db.prepare(`SELECT * FROM cameras`).all() as any[];
}

export function upsertCamera(c: any) {
  db.prepare(
    `INSERT OR REPLACE INTO cameras (id, label, source, kind, lat, lon, whep_url, hls_url, detectors) VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    c.id,
    c.label,
    c.source,
    c.kind,
    c.lat ?? null,
    c.lon ?? null,
    c.whepUrl ?? null,
    c.hlsUrl ?? null,
    JSON.stringify(c.detectors ?? []),
  );
}

export function deleteCamera(id: string) {
  db.prepare(`DELETE FROM cameras WHERE id = ?`).run(id);
}

export function listLocations(): any[] {
  return db.prepare(`SELECT * FROM locations`).all() as any[];
}

export function upsertLocation(l: any) {
  db.prepare(
    `INSERT OR REPLACE INTO locations (id, label, lat, lon, radius_km, kind) VALUES (?,?,?,?,?,?)`,
  ).run(l.id, l.label, l.lat, l.lon, l.radiusKm ?? 25, l.kind ?? "home");
}

export function deleteLocation(id: string) {
  db.prepare(`DELETE FROM locations WHERE id = ?`).run(id);
}

// ---------- Alert rules ----------
export function listRules(): any[] {
  const rows = db.prepare(`SELECT * FROM alert_rules`).all() as any[];
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    enabled: !!r.enabled,
    notify: r.notify ? JSON.parse(r.notify) : {},
    condition: r.condition ? JSON.parse(r.condition) : {},
  }));
}

export function upsertRule(r: any) {
  db.prepare(
    `INSERT OR REPLACE INTO alert_rules (id, label, enabled, notify, condition) VALUES (?,?,?,?,?)`,
  ).run(
    r.id,
    r.label,
    r.enabled ? 1 : 0,
    JSON.stringify(r.notify ?? {}),
    JSON.stringify(r.condition ?? {}),
  );
}

export function deleteRule(id: string) {
  db.prepare(`DELETE FROM alert_rules WHERE id = ?`).run(id);
}

export function listFirings(limit = 100): any[] {
  const rows = db
    .prepare(`SELECT * FROM alert_firings ORDER BY fired_at DESC LIMIT ?`)
    .all(limit) as any[];
  return rows.map((r) => ({
    id: r.id,
    ruleId: r.rule_id,
    ruleLabel: r.rule_label,
    eventId: r.event_id,
    firedAt: r.fired_at,
    reason: r.reason,
    event: r.payload ? JSON.parse(r.payload) : undefined,
  }));
}

export function recordFiring(f: any) {
  db.prepare(
    `INSERT OR REPLACE INTO alert_firings (id, rule_id, rule_label, event_id, fired_at, reason, payload) VALUES (?,?,?,?,?,?,?)`,
  ).run(
    f.id,
    f.ruleId,
    f.ruleLabel,
    f.event?.id ?? null,
    f.firedAt,
    f.reason,
    JSON.stringify(f.event ?? null),
  );
}

// ---------- AOIs ----------
export function listAois(): any[] {
  const rows = db.prepare(`SELECT * FROM aois`).all() as any[];
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    polygon: r.polygon ? JSON.parse(r.polygon) : [],
  }));
}

export function upsertAoi(a: any) {
  db.prepare(`INSERT OR REPLACE INTO aois (id, label, polygon) VALUES (?,?,?)`).run(
    a.id,
    a.label,
    JSON.stringify(a.polygon ?? []),
  );
}

export function deleteAoi(id: string) {
  db.prepare(`DELETE FROM aois WHERE id = ?`).run(id);
}
