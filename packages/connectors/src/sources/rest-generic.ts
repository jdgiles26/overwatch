import { z } from "zod";
import { defineConnector } from "../types.js";
import { fetchJson, sleep } from "../util.js";

const Cfg = z.object({
  url: z.string().default(""),
  intervalMs: z.number().default(60_000),
  headers: z.record(z.string()).default({}),
  jsonPath: z.string().default(""),
  titleKey: z.string().default("title"),
  idKey: z.string().default("id"),
  latKey: z.string().default("lat"),
  lonKey: z.string().default("lon"),
  category: z
    .enum(["iot", "weather", "seismic", "air", "transport", "power", "water", "news", "cv", "space", "finance", "social", "fire", "lightning", "health", "other"])
    .default("iot"),
});

function pick(obj: any, path: string) {
  if (!path) return obj;
  return path.split(".").reduce((o, k) => (o ? o[k] : undefined), obj);
}

export const restGeneric = defineConnector<z.infer<typeof Cfg>>({
  id: "rest-generic",
  label: "Generic REST Poller",
  description: "Poll any JSON REST endpoint; BYO URL, headers, and key map.",
  category: "other",
  authKind: "api-key",
  freeTier: true,
  configSchema: Cfg,
  defaultConfig: {
    url: "",
    intervalMs: 60_000,
    headers: {},
    jsonPath: "",
    titleKey: "title",
    idKey: "id",
    latKey: "lat",
    lonKey: "lon",
    category: "iot",
  },
  async run(ctx) {
    const seen = new Set<string>();
    while (!ctx.signal.aborted) {
      try {
        if (!ctx.config.url) {
          await sleep(5000, ctx.signal);
          continue;
        }
        const d = await fetchJson(ctx.config.url, { headers: ctx.config.headers, signal: ctx.signal });
        const arr = pick(d, ctx.config.jsonPath);
        const list = Array.isArray(arr) ? arr : arr ? [arr] : [];
        for (const item of list) {
          const id = String(pick(item, ctx.config.idKey) ?? JSON.stringify(item).slice(0, 64));
          if (seen.has(id)) continue;
          seen.add(id);
          const lat = Number(pick(item, ctx.config.latKey));
          const lon = Number(pick(item, ctx.config.lonKey));
          ctx.emit({
            id: `rest-${id}`,
            category: ctx.config.category,
            severity: "info",
            title: String(pick(item, ctx.config.titleKey) ?? "Event"),
            summary: JSON.stringify(item).slice(0, 240),
            occurredAt: ctx.now(),
            geo: !isNaN(lat) && !isNaN(lon) ? { lat, lon } : undefined,
            icon: "globe",
            payload: item,
          });
        }
      } catch (e: any) {
        if (!ctx.signal.aborted) ctx.log(`rest: ${e.message}`);
      }
      await sleep(ctx.config.intervalMs, ctx.signal);
    }
  },
});
