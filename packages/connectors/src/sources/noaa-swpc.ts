import { z } from "zod";
import { defineConnector } from "../types.js";
import { fetchJson, sleep } from "../util.js";

const Cfg = z.object({});

export const noaaSwpc = defineConnector<z.infer<typeof Cfg>>({
  id: "noaa-swpc",
  label: "NOAA Space Weather",
  description: "NOAA SWPC alerts, Kp index, solar wind. No key required.",
  category: "space",
  authKind: "none",
  freeTier: true,
  homepageUrl: "https://www.swpc.noaa.gov/",
  configSchema: Cfg,
  defaultConfig: {},
  pollIntervalMs: 10 * 60_000,
  async run(ctx) {
    const seen = new Set<string>();
    while (!ctx.signal.aborted) {
      try {
        const alerts = (await fetchJson(
          "https://services.swpc.noaa.gov/products/alerts.json",
          { signal: ctx.signal },
        )) as any[];
        for (const a of alerts) {
          const id = `swpc-${a.product_id}-${a.issue_datetime}`;
          if (seen.has(id)) continue;
          seen.add(id);
          ctx.emit({
            id,
            category: "space",
            severity: a.message?.toLowerCase().includes("severe") ? "high" : "moderate",
            title: a.space_weather_message_code ?? a.product_id,
            summary: (a.message ?? "").slice(0, 320),
            occurredAt: a.issue_datetime ? new Date(a.issue_datetime.replace(" ", "T") + "Z").toISOString() : ctx.now(),
            icon: "sun",
            payload: a,
          });
        }
      } catch (e: any) {
        if (!ctx.signal.aborted) ctx.log(`swpc: ${e.message}`);
      }
      await sleep(ctx.pollIntervalMs ?? 600_000, ctx.signal);
    }
  },
});
