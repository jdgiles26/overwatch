import type { IngestEvent, Location, PIR, ThreatCon } from "@overwatch/schemas";
import { km } from "@overwatch/connectors";

const sevRank = (s: string): number =>
  (({ info: 0, low: 1, moderate: 2, high: 3, extreme: 4 } as Record<string, number>)[s] ?? 0);

export function computeThreatcon(events: IngestEvent[], locations: Location[]): ThreatCon {
  let score = 0;
  const reasons: string[] = [];
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  const recent = events.filter((e) => new Date(e.receivedAt).getTime() > cutoff);

  const sev = sevRank;

  for (const loc of locations) {
    for (const e of recent) {
      if (!e.geo) continue;
      const d = km(loc.geo, e.geo);
      if (d <= loc.radiusKm) {
        const s = sev(e.severity);
        if (s >= 2) {
          score += s * 0.7;
          if (reasons.length < 8) reasons.push(`${e.title} (${d.toFixed(0)} km from ${loc.label})`);
        }
      }
    }
  }

  // Global severity boost
  for (const e of recent) {
    if (e.severity === "extreme") score += 1;
    else if (e.severity === "high") score += 0.3;
  }

  // Drone-specific boost (additive on top of global; targets: extreme→+2.0 total, high→+1.0 total)
  for (const e of recent) {
    if (e.category !== "drone") continue;
    if (e.severity === "extreme") {
      score += 1.0;
      if (reasons.length < 8) reasons.push(`Extreme drone threat: ${e.title}`);
    } else if (e.severity === "high") {
      score += 0.7;
      if (reasons.length < 8) reasons.push(`High drone threat: ${e.title}`);
    }
  }

  score = Math.min(10, score);
  const level: ThreatCon["level"] =
    score >= 8 ? "critical" : score >= 6 ? "high" : score >= 4 ? "elevated" : score >= 2 ? "guarded" : "nominal";

  return {
    score: Math.round(score * 10) / 10,
    level,
    reasons: reasons.slice(0, 6),
    computedAt: new Date().toISOString(),
  };
}

export function computePIR(events: IngestEvent[], locations: Location[]): PIR[] {
  const cutoff24 = Date.now() - 24 * 60 * 60 * 1000;
  const cutoff1 = Date.now() - 60 * 60 * 1000;
  const recent24 = events.filter((e) => new Date(e.receivedAt).getTime() > cutoff24);
  const recent1 = events.filter((e) => new Date(e.receivedAt).getTime() > cutoff1);

  const has = (pred: (e: IngestEvent) => boolean, arr: IngestEvent[] = recent24): boolean =>
    arr.some(pred);
  const near = (e: IngestEvent, radius: number): boolean =>
    !!e.geo && locations.some((l) => km(l.geo, e.geo!) <= radius);

  const yn = (b: boolean): "yes" | "no" => (b ? "yes" : "no");
  const mk = (id: string, question: string, answer: "yes" | "no" | "unknown", detail?: string): PIR => ({
    id,
    question,
    answer,
    detail,
    evidenceIds: [],
  });

  return [
    mk(
      "weather-25km",
      "Severe weather within 25 miles?",
      yn(
        has(
          (e) =>
            e.category === "weather" &&
            (e.severity === "high" || e.severity === "extreme") &&
            near(e, 40),
        ),
      ),
      "NWS + Open-Meteo aggregated over the last 24h.",
    ),
    mk(
      "quake-200km",
      "Earthquake M4+ within 200 km in the last 24h?",
      yn(has((e) => e.category === "seismic" && (e.payload?.mag ?? 0) >= 4 && near(e, 200))),
    ),
    mk("fire-nearby", "Active wildfire within 100 km?", yn(has((e) => e.category === "fire" && near(e, 100)))),
    mk(
      "aqi-poor",
      "Poor air quality (PM2.5>35) near a location?",
      yn(
        has(
          (e) =>
            e.category === "air" &&
            (e.severity === "moderate" || e.severity === "high" || e.severity === "extreme") &&
            near(e, 30),
        ),
      ),
    ),
    mk(
      "iot-breach",
      "IoT anomaly flagged in the last hour?",
      yn(
        has(
          (e) => e.category === "iot" && (e.severity === "high" || e.severity === "moderate"),
          recent1,
        ),
      ),
    ),
    mk(
      "cv-alert",
      "Computer-vision detector fired in the last hour?",
      yn(has((e) => e.category === "cv", recent1)),
    ),
    (() => {
      const cutoff15 = Date.now() - 15 * 60 * 1000;
      const cutoff60 = Date.now() - 60 * 60 * 1000;
      const droneHigh15 = events.filter(
        (e) => e.category === "drone" && sevRank(e.severity) >= 3 && new Date(e.receivedAt).getTime() > cutoff15,
      );
      const droneAny60 = events.filter(
        (e) => e.category === "drone" && new Date(e.receivedAt).getTime() > cutoff60,
      );
      return mk(
        "drone-alert",
        "Is hostile drone activity detected in the AO?",
        droneHigh15.length > 0 ? "yes" : droneAny60.length > 0 ? "unknown" : "no",
        droneHigh15[0] ? `Last: ${droneHigh15[0].title}` : undefined,
      );
    })(),
  ];
}
