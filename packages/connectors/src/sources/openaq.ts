import { z } from "zod";
import { defineConnector } from "../types.js";
import { fetchJson, sleep } from "../util.js";

const Cfg = z.object({
  apiKey: z.string().default(""),
  bbox: z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .default([-125, 24, -66, 50]),
  parameter: z.enum(["pm25", "pm10", "o3", "no2", "so2", "co"]).default("pm25"),
  limit: z.number().default(200),
});

export const openaq = defineConnector<z.infer<typeof Cfg>>({
  id: "openaq",
  label: "OpenAQ Air Quality",
  description: "Global air quality measurements. Free API key from openaq.org boosts limits.",
  category: "air",
  authKind: "api-key",
  freeTier: true,
  homepageUrl: "https://openaq.org",
  docsUrl: "https://docs.openaq.org",
  configSchema: Cfg,
  defaultConfig: { apiKey: "", bbox: [-125, 24, -66, 50], parameter: "pm25", limit: 200 },
  pollIntervalMs: 10 * 60_000,
  async run(ctx) {
    const seen = new Map<string, number>();
    while (!ctx.signal.aborted) {
      try {
        const [minLon, minLat, maxLon, maxLat] = ctx.config.bbox;
        const url = `https://api.openaq.org/v3/measurements?bbox=${minLon},${minLat},${maxLon},${maxLat}&parameter=${ctx.config.parameter}&limit=${ctx.config.limit}`;
        const headers: Record<string, string> = {};
        if (ctx.config.apiKey) headers["X-API-Key"] = ctx.config.apiKey;
        const data = await fetchJson(url, { headers, signal: ctx.signal }).catch(() => ({ results: [] }));
        for (const m of data.results ?? []) {
          const key = `${m.locationId}:${m.datetime?.utc ?? m.date?.utc}`;
          if (seen.has(key)) continue;
          seen.set(key, Date.now());
          const v = m.value ?? 0;
          const sev = v > 150 ? "extreme" : v > 55 ? "high" : v > 35 ? "moderate" : v > 12 ? "low" : "info";
          ctx.emit({
            id: `openaq-${key}`,
            category: "air",
            severity: sev,
            title: `${ctx.config.parameter.toUpperCase()} ${v.toFixed(1)} ${m.unit}`,
            summary: m.location ?? "AQ reading",
            occurredAt: m.datetime?.utc ?? ctx.now(),
            geo: m.coordinates ? { lat: m.coordinates.latitude, lon: m.coordinates.longitude } : undefined,
            icon: "wind",
            payload: m,
          });
        }
      } catch (e: any) {
        if (!ctx.signal.aborted) ctx.log(`openaq: ${e.message}`);
      }
      await sleep(ctx.pollIntervalMs ?? 600_000, ctx.signal);
    }
  },
});
