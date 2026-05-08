import { z } from "zod";
import { parseStringPromise } from "xml2js";
import { defineConnector } from "../types.js";
import { fetchText, sleep } from "../util.js";

const Cfg = z.object({
  urls: z
    .array(z.string())
    .default([
      "https://feeds.bbci.co.uk/news/rss.xml",
      "https://www.cisa.gov/cybersecurity-advisories/all.xml",
    ]),
  category: z
    .enum(["news", "iot", "weather", "seismic", "air", "transport", "power", "water", "cv", "drone", "space", "finance", "social", "fire", "lightning", "health", "other"])
    .default("news"),
});

export const rssFeed = defineConnector<z.infer<typeof Cfg>>({
  id: "rss",
  label: "Generic RSS/Atom",
  description: "Poll any RSS/Atom feeds; no key required.",
  category: "news",
  authKind: "none",
  freeTier: true,
  configSchema: Cfg,
  defaultConfig: {
    urls: [
      "https://feeds.bbci.co.uk/news/rss.xml",
      "https://www.cisa.gov/cybersecurity-advisories/all.xml",
    ],
    category: "news",
  },
  pollIntervalMs: 5 * 60_000,
  async run(ctx) {
    const seen = new Set<string>();
    while (!ctx.signal.aborted) {
      for (const url of ctx.config.urls) {
        try {
          const xml = await fetchText(url, { signal: ctx.signal });
          const doc = await parseStringPromise(xml, { explicitArray: false });
          const items =
            doc?.rss?.channel?.item ??
            doc?.feed?.entry ??
            (Array.isArray(doc?.rdf?.item) ? doc.rdf.item : []);
          const arr = Array.isArray(items) ? items : items ? [items] : [];
          for (const it of arr) {
            const title =
              typeof it.title === "string" ? it.title : it.title?._ ?? "(untitled)";
            const link =
              typeof it.link === "string" ? it.link : it.link?.$?.href ?? it.link?._ ?? it.guid?._ ?? it.id ?? "";
            const date = it.pubDate ?? it.updated ?? it.published ?? new Date().toISOString();
            const id = `rss-${link || title}`;
            if (seen.has(id)) continue;
            seen.add(id);
            ctx.emit({
              id,
              category: ctx.config.category,
              severity: "info",
              title: String(title).slice(0, 200),
              summary: String(it.description ?? it.summary ?? "").replace(/<[^>]*>/g, "").slice(0, 240),
              occurredAt: new Date(date).toISOString(),
              url: String(link || undefined),
              icon: "rss",
            });
          }
        } catch (e: any) {
          if (!ctx.signal.aborted) ctx.log(`rss ${url}: ${e.message}`);
        }
      }
      await sleep(ctx.pollIntervalMs ?? 300_000, ctx.signal);
    }
  },
});
