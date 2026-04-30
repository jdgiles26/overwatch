import { z } from "zod";
import { defineConnector } from "../types.js";
import { fetchJson, sleep } from "../util.js";

const Cfg = z.object({ token: z.string().default(""), limit: z.number().default(30) });

export const githubEvents = defineConnector<z.infer<typeof Cfg>>({
  id: "github-events",
  label: "GitHub Public Events",
  description: "Public GitHub Events API. Token optional for higher rate limits.",
  category: "social",
  authKind: "api-key",
  freeTier: true,
  homepageUrl: "https://docs.github.com/en/rest/activity/events",
  configSchema: Cfg,
  defaultConfig: { token: "", limit: 30 },
  pollIntervalMs: 2 * 60_000,
  async run(ctx) {
    const seen = new Set<string>();
    while (!ctx.signal.aborted) {
      try {
        const headers: Record<string, string> = { accept: "application/vnd.github+json" };
        if (ctx.config.token) headers["Authorization"] = `Bearer ${ctx.config.token}`;
        const d = await fetchJson(`https://api.github.com/events?per_page=${ctx.config.limit}`, {
          headers,
          signal: ctx.signal,
        });
        for (const e of d ?? []) {
          if (seen.has(e.id)) continue;
          seen.add(e.id);
          ctx.emit({
            id: `gh-${e.id}`,
            category: "social",
            severity: "info",
            title: `${e.type} on ${e.repo?.name}`,
            summary: `@${e.actor?.login}`,
            occurredAt: e.created_at ?? ctx.now(),
            url: `https://github.com/${e.repo?.name}`,
            icon: "github",
            payload: e,
          });
        }
      } catch (e: any) {
        if (!ctx.signal.aborted) ctx.log(`gh: ${e.message}`);
      }
      await sleep(ctx.pollIntervalMs ?? 120_000, ctx.signal);
    }
  },
});
