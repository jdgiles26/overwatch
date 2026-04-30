import { z } from "zod";
import { defineConnector } from "../types.js";
import { fetchJson, sleep } from "../util.js";

const Cfg = z.object({
  coins: z.array(z.string()).default(["bitcoin", "ethereum", "solana"]),
  vs: z.string().default("usd"),
});

export const coinGecko = defineConnector<z.infer<typeof Cfg>>({
  id: "coingecko",
  label: "CoinGecko Crypto Prices",
  description: "Free public crypto price feed, no key required.",
  category: "finance",
  authKind: "none",
  freeTier: true,
  homepageUrl: "https://www.coingecko.com/en/api",
  configSchema: Cfg,
  defaultConfig: { coins: ["bitcoin", "ethereum", "solana"], vs: "usd" },
  pollIntervalMs: 60_000,
  async run(ctx) {
    while (!ctx.signal.aborted) {
      try {
        const d = await fetchJson(
          `https://api.coingecko.com/api/v3/simple/price?ids=${ctx.config.coins.join(",")}&vs_currencies=${ctx.config.vs}&include_24hr_change=true`,
          { signal: ctx.signal },
        );
        for (const [coin, v] of Object.entries<any>(d)) {
          const price = v[ctx.config.vs];
          const ch = v[`${ctx.config.vs}_24h_change`] ?? 0;
          ctx.emit({
            id: `cg-${coin}-${Math.floor(Date.now() / 60000)}`,
            category: "finance",
            severity: Math.abs(ch) > 10 ? "moderate" : "info",
            title: `${coin.toUpperCase()}: ${price} ${ctx.config.vs}`,
            summary: `${ch >= 0 ? "+" : ""}${ch.toFixed(2)}% 24h`,
            occurredAt: ctx.now(),
            icon: "coins",
            payload: v,
          });
        }
      } catch (e: any) {
        if (!ctx.signal.aborted) ctx.log(`coingecko: ${e.message}`);
      }
      await sleep(ctx.pollIntervalMs ?? 60_000, ctx.signal);
    }
  },
});
