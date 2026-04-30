import { z } from "zod";
import { defineConnector } from "../types.js";
import { fetchJson, sleep } from "../util.js";

const Cfg = z.object({ intervalMs: z.number().default(10_000) });

export const issLocation = defineConnector<z.infer<typeof Cfg>>({
  id: "iss-location",
  label: "ISS Live Position",
  description: "International Space Station live lat/lon (open-notify). No key required.",
  category: "space",
  authKind: "none",
  freeTier: true,
  homepageUrl: "http://api.open-notify.org/",
  configSchema: Cfg,
  defaultConfig: { intervalMs: 10_000 },
  async run(ctx) {
    while (!ctx.signal.aborted) {
      try {
        const d = await fetchJson("https://api.wheretheiss.at/v1/satellites/25544", { signal: ctx.signal });
        ctx.emit({
          id: `iss-${Math.floor(Date.now() / (ctx.config.intervalMs ?? 10_000))}`,
          category: "space",
          severity: "info",
          title: "ISS Position",
          summary: `Alt ${Math.round(d.altitude)} km, v ${Math.round(d.velocity)} km/h`,
          occurredAt: new Date(d.timestamp * 1000).toISOString(),
          geo: { lat: d.latitude, lon: d.longitude, alt: d.altitude * 1000 },
          icon: "satellite",
          payload: d,
        });
      } catch (e: any) {
        if (!ctx.signal.aborted) ctx.log(`iss: ${e.message}`);
      }
      await sleep(ctx.config.intervalMs ?? 10_000, ctx.signal);
    }
  },
});
