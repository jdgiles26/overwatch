import { z } from "zod";
import { defineConnector } from "../types.js";
import { fetchJson, sleep } from "../util.js";

const Cfg = z.object({ days: z.number().default(10), status: z.enum(["open", "closed", "all"]).default("open") });

export const nasaEonet = defineConnector<z.infer<typeof Cfg>>({
  id: "nasa-eonet",
  label: "NASA EONET (Natural Events)",
  description: "Earth Observatory Natural Event Tracker — wildfires, storms, volcanoes. No key required.",
  category: "fire",
  authKind: "none",
  freeTier: true,
  homepageUrl: "https://eonet.gsfc.nasa.gov/docs/v3",
  configSchema: Cfg,
  defaultConfig: { days: 10, status: "open" },
  pollIntervalMs: 5 * 60_000,
  async run(ctx) {
    const seen = new Set<string>();
    while (!ctx.signal.aborted) {
      try {
        const url = `https://eonet.gsfc.nasa.gov/api/v3/events?days=${ctx.config.days}&status=${ctx.config.status}`;
        const data = await fetchJson(url, { signal: ctx.signal });
        for (const ev of data.events ?? []) {
          if (seen.has(ev.id)) continue;
          seen.add(ev.id);
          const last = ev.geometry?.[ev.geometry.length - 1];
          const coords = last?.coordinates;
          const cat = ev.categories?.[0]?.title?.toLowerCase() ?? "";
          const category = cat.includes("fire")
            ? "fire"
            : cat.includes("storm") || cat.includes("cyclone")
            ? "weather"
            : cat.includes("volcano")
            ? "seismic"
            : cat.includes("ice")
            ? "other"
            : "other";
          ctx.emit({
            id: ev.id,
            category,
            severity: "moderate",
            title: ev.title,
            summary: ev.description ?? ev.categories?.[0]?.title,
            occurredAt: last?.date ?? ctx.now(),
            geo: coords ? { lat: coords[1], lon: coords[0] } : undefined,
            icon: cat.includes("fire") ? "flame" : cat.includes("volcano") ? "mountain" : "globe",
            url: ev.link,
            payload: ev,
          });
        }
      } catch (e: any) {
        if (!ctx.signal.aborted) ctx.log(`nasa-eonet: ${e.message}`);
      }
      await sleep(ctx.pollIntervalMs ?? 300_000, ctx.signal);
    }
  },
});
