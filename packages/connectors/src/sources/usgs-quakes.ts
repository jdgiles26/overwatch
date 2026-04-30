import { z } from "zod";
import { defineConnector } from "../types.js";
import { fetchJson, sleep } from "../util.js";

const Cfg = z.object({
  feed: z
    .enum([
      "all_hour",
      "all_day",
      "all_week",
      "significant_day",
      "significant_week",
      "1.0_hour",
      "2.5_day",
      "4.5_week",
    ])
    .default("all_hour"),
  minMag: z.number().default(1),
});

export const usgsQuakes = defineConnector<z.infer<typeof Cfg>>({
  id: "usgs-quakes",
  label: "USGS Earthquakes",
  description: "USGS real-time earthquake GeoJSON feeds — no key required.",
  category: "seismic",
  authKind: "none",
  freeTier: true,
  homepageUrl: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php",
  configSchema: Cfg,
  defaultConfig: { feed: "all_hour", minMag: 1 },
  pollIntervalMs: 60_000,
  async run(ctx) {
    const seen = new Set<string>();
    while (!ctx.signal.aborted) {
      try {
        const url = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${ctx.config.feed}.geojson`;
        const data = await fetchJson(url, { signal: ctx.signal });
        for (const f of data.features ?? []) {
          const id = f.id;
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const mag = f.properties?.mag ?? 0;
          if (mag < ctx.config.minMag) continue;
          const [lon, lat] = f.geometry.coordinates;
          ctx.emit({
            id,
            category: "seismic",
            severity: mag >= 6 ? "extreme" : mag >= 5 ? "high" : mag >= 3.5 ? "moderate" : "low",
            title: `M${mag.toFixed(1)} — ${f.properties.place}`,
            summary: f.properties.title,
            occurredAt: new Date(f.properties.time).toISOString(),
            geo: { lat, lon, alt: f.geometry.coordinates[2] ?? 0 },
            geoMentioned: f.properties.place,
            url: f.properties.url,
            icon: "waves",
            payload: { mag, depth: f.geometry.coordinates[2], ...f.properties },
          });
        }
      } catch (e: any) {
        if (!ctx.signal.aborted) ctx.log(`usgs-quakes: ${e.message}`);
      }
      await sleep(ctx.pollIntervalMs ?? 60_000, ctx.signal);
    }
  },
});
