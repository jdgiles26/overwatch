import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import type {
  AlertFiring,
  AlertRule,
  IngestEvent,
  Severity,
} from "@overwatch/schemas";
import { listLocations, listRules, recordFiring } from "./db.js";

const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  extreme: 4,
};

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export class RuleEngine extends EventEmitter {
  private rules: AlertRule[] = [];
  private lastFire = new Map<string, number>(); // ruleId -> ts

  constructor() {
    super();
    this.reload();
  }

  reload() {
    this.rules = listRules() as AlertRule[];
    this.emit("rules", this.rules);
  }

  list(): AlertRule[] {
    return [...this.rules];
  }

  evaluate(event: IngestEvent): AlertFiring[] {
    const out: AlertFiring[] = [];
    const now = Date.now();
    let _locations: any[] | null = null;
    const getLocations = () => (_locations ??= listLocations());
    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      const reasons: string[] = [];
      const c = rule.condition;
      if (c.categories?.length && !c.categories.includes(event.category)) continue;
      if (c.minSeverity) {
        const e = SEVERITY_RANK[event.severity] ?? 0;
        const m = SEVERITY_RANK[c.minSeverity] ?? 0;
        if (e < m) continue;
        reasons.push(`severity ${event.severity} >= ${c.minSeverity}`);
      } else {
        reasons.push(`severity ${event.severity}`);
      }
      if (c.keywords?.length) {
        const haystack = `${event.title} ${event.summary ?? ""}`.toLowerCase();
        const hit = c.keywords.find((k) => haystack.includes(k.toLowerCase()));
        if (!hit) continue;
        reasons.push(`keyword "${hit}"`);
      }
      if (c.bbox) {
        if (!event.geo) continue;
        const [minLon, minLat, maxLon, maxLat] = c.bbox;
        if (
          event.geo.lat < minLat ||
          event.geo.lat > maxLat ||
          event.geo.lon < minLon ||
          event.geo.lon > maxLon
        )
          continue;
        reasons.push(`inside bbox`);
      }
      if (c.nearLocationId && c.nearKm) {
        if (!event.geo) continue;
        const loc = getLocations().find((l: any) => l.id === c.nearLocationId);
        if (!loc) continue;
        const d = distanceKm(event.geo, { lat: loc.lat, lon: loc.lon });
        if (d > c.nearKm) continue;
        reasons.push(`${d.toFixed(1)}km from ${loc.label}`);
      }
      const lim = c.rateLimitMs ?? 60_000;
      const last = this.lastFire.get(rule.id) ?? 0;
      if (now - last < lim) continue;
      this.lastFire.set(rule.id, now);
      const firing: AlertFiring = {
        id: `fire_${crypto.randomBytes(6).toString("hex")}`,
        ruleId: rule.id,
        ruleLabel: rule.label,
        event,
        firedAt: new Date(now).toISOString(),
        reason: reasons.join(" + "),
      };
      try {
        recordFiring(firing);
      } catch (e) {
        // best-effort persistence
      }
      out.push(firing);
      this.emit("alert", firing);
    }
    return out;
  }
}
