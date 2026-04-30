import { z } from "zod";
import { defineConnector } from "../types.js";
import { fetchJson, sleep } from "../util.js";

const Cfg = z.object({
  query: z.string().default("protest OR wildfire OR flood OR earthquake"),
  maxrecords: z.number().default(75),
});

export const gdelt = defineConnector<z.infer<typeof Cfg>>({
  id: "gdelt",
  label: "GDELT Global Events",
  description: "GDELT 2.0 DOC API — world news events with tone and geo. No key.",
  category: "news",
  authKind: "none",
  freeTier: true,
  homepageUrl: "https://www.gdeltproject.org/",
  configSchema: Cfg,
  defaultConfig: { query: "protest OR wildfire OR flood OR earthquake", maxrecords: 75 },
  pollIntervalMs: 5 * 60_000,
  async run(ctx) {
    const seen = new Set<string>();
    while (!ctx.signal.aborted) {
      try {
        const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(
          ctx.config.query,
        )}&mode=artlist&format=json&maxrecords=${ctx.config.maxrecords}&sort=datedesc`;
        const data = await fetchJson(url, { signal: ctx.signal });
        for (const a of data.articles ?? []) {
          const id = `gdelt-${a.url}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const tone = Number(a.tone ?? 0);
          ctx.emit({
            id,
            category: "news",
            severity: tone < -5 ? "moderate" : "info",
            title: a.title,
            summary: a.sourcecountry ? `${a.sourcecountry} — ${a.domain}` : a.domain,
            occurredAt: parseGdeltDate(a.seendate) ?? ctx.now(),
            geoMentioned: a.sourcecountry,
            url: a.url,
            icon: "newspaper",
            payload: a,
          });
        }
      } catch (e: any) {
        if (!ctx.signal.aborted) ctx.log(`gdelt: ${e.message}`);
      }
      await sleep(ctx.pollIntervalMs ?? 300_000, ctx.signal);
    }
  },
});

function parseGdeltDate(s?: string): string | undefined {
  if (!s) return undefined;
  const m = s.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/);
  if (!m) return undefined;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}
