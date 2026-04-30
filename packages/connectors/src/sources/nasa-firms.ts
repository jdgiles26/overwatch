import { z } from "zod";
import { defineConnector } from "../types.js";
import { fetchText, sleep } from "../util.js";

const Cfg = z.object({
  mapKey: z.string().default(""),
  source: z.enum(["VIIRS_SNPP_NRT", "MODIS_NRT", "VIIRS_NOAA20_NRT"]).default("VIIRS_SNPP_NRT"),
  area: z.string().default("USA"),
  days: z.number().default(1),
});

export const nasaFirms = defineConnector<z.infer<typeof Cfg>>({
  id: "nasa-firms",
  label: "NASA FIRMS Wildfires",
  description: "Active fire detections (VIIRS/MODIS). Free MAP_KEY from firms.modaps.eosdis.nasa.gov/api/map_key.",
  category: "fire",
  authKind: "api-key",
  freeTier: true,
  homepageUrl: "https://firms.modaps.eosdis.nasa.gov/api/",
  configSchema: Cfg,
  defaultConfig: { mapKey: "", source: "VIIRS_SNPP_NRT", area: "USA", days: 1 },
  pollIntervalMs: 15 * 60_000,
  async run(ctx) {
    const seen = new Set<string>();
    while (!ctx.signal.aborted) {
      try {
        if (!ctx.config.mapKey) {
          await sleep(60_000, ctx.signal);
          continue;
        }
        const url = `https://firms.modaps.eosdis.nasa.gov/api/country/csv/${ctx.config.mapKey}/${ctx.config.source}/${ctx.config.area}/${ctx.config.days}`;
        const csv = await fetchText(url, { signal: ctx.signal });
        const [head, ...rows] = csv.trim().split("\n");
        if (!head) continue;
        const cols = head.split(",");
        const iLat = cols.indexOf("latitude");
        const iLon = cols.indexOf("longitude");
        const iFrp = cols.indexOf("frp");
        const iDate = cols.indexOf("acq_date");
        const iTime = cols.indexOf("acq_time");
        for (const r of rows) {
          const c = r.split(",");
          const lat = Number(c[iLat]);
          const lon = Number(c[iLon]);
          const id = `firms-${lat.toFixed(3)}-${lon.toFixed(3)}-${c[iDate]}${c[iTime]}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const frp = Number(c[iFrp] ?? 0);
          ctx.emit({
            id,
            category: "fire",
            severity: frp > 100 ? "high" : frp > 20 ? "moderate" : "low",
            title: `Wildfire hotspot (FRP ${frp.toFixed(1)} MW)`,
            summary: `${ctx.config.source} ${c[iDate]} ${c[iTime]}`,
            occurredAt: new Date().toISOString(),
            geo: { lat, lon },
            icon: "flame",
            payload: Object.fromEntries(cols.map((col, i) => [col, c[i]])),
          });
        }
      } catch (e: any) {
        if (!ctx.signal.aborted) ctx.log(`firms: ${e.message}`);
      }
      await sleep(ctx.pollIntervalMs ?? 15 * 60_000, ctx.signal);
    }
  },
});
