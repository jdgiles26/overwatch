import { z } from "zod";
import { defineConnector, genId } from "../types.js";

const Cfg = z.object({
  area: z.string().default("").describe("Optional 2-letter state code, e.g. CA"),
  minSeverity: z.enum(["Minor", "Moderate", "Severe", "Extreme"]).default("Minor"),
});

export const nwsAlerts = defineConnector<z.infer<typeof Cfg>>({
  id: "nws-alerts",
  label: "NWS Weather Alerts",
  description: "National Weather Service CAP/GeoJSON active alerts — no key required.",
  category: "weather",
  authKind: "none",
  freeTier: true,
  homepageUrl: "https://www.weather.gov/documentation/services-web-api",
  configSchema: Cfg,
  defaultConfig: { area: "", minSeverity: "Minor" },
  pollIntervalMs: 60_000,
  async run(ctx) {
    const seen = new Set<string>();
    while (!ctx.signal.aborted) {
      try {
        const url = new URL("https://api.weather.gov/alerts/active");
        if (ctx.config.area) url.searchParams.set("area", ctx.config.area);
        const r = await fetch(url, {
          headers: { "User-Agent": "overwatch/0.1 (demo)" },
          signal: ctx.signal,
        });
        if (!r.ok) throw new Error(`NWS ${r.status}`);
        const data = (await r.json()) as any;
        for (const f of data.features ?? []) {
          const id = f.id ?? f.properties?.id;
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const p = f.properties ?? {};
          const sev = (p.severity ?? "Minor") as string;
          const rank = ["Minor", "Moderate", "Severe", "Extreme"];
          if (rank.indexOf(sev) < rank.indexOf(ctx.config.minSeverity)) continue;
          const centroid = extractCentroid(f.geometry);
          ctx.emit({
            id,
            category: "weather",
            severity: severityMap(sev),
            title: p.event ?? "NWS Alert",
            summary: p.headline ?? p.description ?? "",
            occurredAt: p.sent ?? ctx.now(),
            geo: centroid,
            geoMentioned: p.areaDesc,
            url: p.uri ?? f.id,
            icon: "cloud-lightning",
            payload: { nws: p },
          });
        }
      } catch (e: any) {
        if (ctx.signal.aborted) return;
        ctx.log(`nws error: ${e.message ?? e}`);
      }
      await sleep(ctx.pollIntervalMs ?? 60_000, ctx.signal);
    }
  },
});

function severityMap(s: string) {
  return (
    { Minor: "low", Moderate: "moderate", Severe: "high", Extreme: "extreme" } as const
  )[s] ?? "info";
}

function extractCentroid(geom: any): { lat: number; lon: number } | undefined {
  if (!geom) return undefined;
  const pts: [number, number][] = [];
  const walk = (g: any) => {
    if (!g) return;
    if (g.type === "Point") pts.push(g.coordinates);
    else if (g.type === "Polygon") for (const ring of g.coordinates) for (const c of ring) pts.push(c);
    else if (g.type === "MultiPolygon")
      for (const poly of g.coordinates) for (const ring of poly) for (const c of ring) pts.push(c);
    else if (g.type === "GeometryCollection") g.geometries.forEach(walk);
  };
  walk(geom);
  if (!pts.length) return undefined;
  let lon = 0;
  let lat = 0;
  for (const p of pts) {
    lon += p[0];
    lat += p[1];
  }
  return { lat: lat / pts.length, lon: lon / pts.length };
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((res) => {
    const t = setTimeout(res, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      res();
    });
  });
}

void genId;
