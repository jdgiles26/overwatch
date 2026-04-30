import { z } from "zod";
import { defineConnector } from "../types.js";

const Cfg = z.object({ languages: z.array(z.string()).default(["en"]) });

export const wikipediaRc = defineConnector<z.infer<typeof Cfg>>({
  id: "wikipedia-rc",
  label: "Wikipedia Recent Changes",
  description: "Wikimedia EventStreams SSE — live edits worldwide. No key required.",
  category: "social",
  authKind: "none",
  freeTier: true,
  homepageUrl: "https://stream.wikimedia.org/?doc",
  configSchema: Cfg,
  defaultConfig: { languages: ["en"] },
  async run(ctx) {
    while (!ctx.signal.aborted) {
      try {
        const res = await fetch("https://stream.wikimedia.org/v2/stream/recentchange", {
          signal: ctx.signal,
          headers: { accept: "text/event-stream", "User-Agent": "overwatch/0.1 (demo)" },
        });
        if (!res.ok || !res.body) throw new Error(`wiki ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (!ctx.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const p of parts) {
            const dataLine = p.split("\n").find((l) => l.startsWith("data:"));
            if (!dataLine) continue;
            try {
              const d = JSON.parse(dataLine.slice(5).trim());
              if (!ctx.config.languages.includes(d.wiki?.replace("wiki", ""))) continue;
              if (d.type !== "edit" && d.type !== "new") continue;
              ctx.emit({
                id: `wiki-${d.id}-${d.timestamp}`,
                category: "social",
                severity: "info",
                title: `${d.title}`,
                summary: `${d.user} • ${d.wiki} • ${d.comment ?? ""}`.slice(0, 180),
                occurredAt: new Date((d.timestamp ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
                url: d.meta?.uri,
                icon: "book",
                payload: d,
              });
            } catch {
              /* ignore parse */
            }
          }
        }
      } catch (e: any) {
        if (!ctx.signal.aborted) ctx.log(`wiki: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  },
});
