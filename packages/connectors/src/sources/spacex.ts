import { z } from "zod";
import { defineConnector } from "../types.js";
import { fetchJson, sleep } from "../util.js";

const Cfg = z.object({ upcoming: z.boolean().default(true) });

export const spacex = defineConnector<z.infer<typeof Cfg>>({
  id: "spacex-launches",
  label: "SpaceX Launches",
  description: "Upcoming/past SpaceX launches (r/spacex v4 API). No key.",
  category: "space",
  authKind: "none",
  freeTier: true,
  homepageUrl: "https://github.com/r-spacex/SpaceX-API",
  configSchema: Cfg,
  defaultConfig: { upcoming: true },
  pollIntervalMs: 60 * 60_000,
  async run(ctx) {
    const seen = new Set<string>();
    while (!ctx.signal.aborted) {
      try {
        const path = ctx.config.upcoming ? "upcoming" : "latest";
        const data = await fetchJson(`https://api.spacexdata.com/v5/launches/${path}`, { signal: ctx.signal });
        const arr = Array.isArray(data) ? data : [data];
        for (const l of arr) {
          if (seen.has(l.id)) continue;
          seen.add(l.id);
          ctx.emit({
            id: `spacex-${l.id}`,
            category: "space",
            severity: "info",
            title: `SpaceX: ${l.name}`,
            summary: l.details ?? "",
            occurredAt: l.date_utc ?? ctx.now(),
            icon: "rocket",
            url: l.links?.webcast ?? l.links?.wikipedia,
            payload: l,
          });
        }
      } catch (e: any) {
        if (!ctx.signal.aborted) ctx.log(`spacex: ${e.message}`);
      }
      await sleep(ctx.pollIntervalMs ?? 3600_000, ctx.signal);
    }
  },
});
