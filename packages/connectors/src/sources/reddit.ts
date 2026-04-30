import { z } from "zod";
import { defineConnector } from "../types.js";
import { fetchJson, sleep } from "../util.js";

const Cfg = z.object({
  subreddits: z.array(z.string()).default(["worldnews", "news", "weather"]),
  limit: z.number().default(15),
});

export const reddit = defineConnector<z.infer<typeof Cfg>>({
  id: "reddit",
  label: "Reddit JSON Feeds",
  description: "Public Reddit JSON endpoints. No auth for read-only listings.",
  category: "social",
  authKind: "none",
  freeTier: true,
  homepageUrl: "https://www.reddit.com/dev/api",
  configSchema: Cfg,
  defaultConfig: { subreddits: ["worldnews", "news", "weather"], limit: 15 },
  pollIntervalMs: 2 * 60_000,
  async run(ctx) {
    const seen = new Set<string>();
    while (!ctx.signal.aborted) {
      for (const sub of ctx.config.subreddits) {
        try {
          const d = await fetchJson(`https://www.reddit.com/r/${sub}/new.json?limit=${ctx.config.limit}`, {
            signal: ctx.signal,
            headers: { "User-Agent": "overwatch/0.1 (demo)" },
          });
          for (const c of d?.data?.children ?? []) {
            const p = c.data;
            if (seen.has(p.id)) continue;
            seen.add(p.id);
            ctx.emit({
              id: `reddit-${p.id}`,
              category: "social",
              severity: p.over_18 ? "low" : "info",
              title: `r/${sub}: ${p.title}`,
              summary: `u/${p.author} • ${p.ups} ↑ • ${p.num_comments} comments`,
              occurredAt: new Date((p.created_utc ?? 0) * 1000).toISOString(),
              url: `https://www.reddit.com${p.permalink}`,
              icon: "message-circle",
              payload: p,
            });
          }
        } catch (e: any) {
          if (!ctx.signal.aborted) ctx.log(`reddit ${sub}: ${e.message}`);
        }
      }
      await sleep(ctx.pollIntervalMs ?? 120_000, ctx.signal);
    }
  },
});
