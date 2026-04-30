import { z } from "zod";
import { defineConnector } from "../types.js";
import { fetchJson, sleep } from "../util.js";

const Cfg = z.object({ kind: z.enum(["top", "new", "show"]).default("new"), limit: z.number().default(20) });

export const hackerNews = defineConnector<z.infer<typeof Cfg>>({
  id: "hackernews",
  label: "Hacker News",
  description: "HN Firebase API. No key required.",
  category: "social",
  authKind: "none",
  freeTier: true,
  homepageUrl: "https://github.com/HackerNews/API",
  configSchema: Cfg,
  defaultConfig: { kind: "new", limit: 20 },
  pollIntervalMs: 60_000,
  async run(ctx) {
    const seen = new Set<number>();
    while (!ctx.signal.aborted) {
      try {
        const ids = (await fetchJson(
          `https://hacker-news.firebaseio.com/v0/${ctx.config.kind}stories.json`,
          { signal: ctx.signal },
        )) as number[];
        for (const id of ids.slice(0, ctx.config.limit)) {
          if (seen.has(id)) continue;
          seen.add(id);
          const item = await fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
            signal: ctx.signal,
          }).catch(() => null);
          if (!item) continue;
          ctx.emit({
            id: `hn-${id}`,
            category: "social",
            severity: "info",
            title: item.title,
            summary: `by ${item.by} • ${item.score ?? 0} pts • ${item.descendants ?? 0} comments`,
            occurredAt: new Date((item.time ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
            url: item.url ?? `https://news.ycombinator.com/item?id=${id}`,
            icon: "message-square",
            payload: item,
          });
        }
      } catch (e: any) {
        if (!ctx.signal.aborted) ctx.log(`hn: ${e.message}`);
      }
      await sleep(ctx.pollIntervalMs ?? 60_000, ctx.signal);
    }
  },
});
