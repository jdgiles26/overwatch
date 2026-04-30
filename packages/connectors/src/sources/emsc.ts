import { z } from "zod";
import WebSocket from "ws";
import { defineConnector } from "../types.js";

const Cfg = z.object({ minMag: z.number().default(2.5) });

export const emsc = defineConnector<z.infer<typeof Cfg>>({
  id: "emsc",
  label: "EMSC Seismic Stream",
  description: "European-Mediterranean Seismological Centre live earthquake WebSocket.",
  category: "seismic",
  authKind: "none",
  freeTier: true,
  homepageUrl: "https://www.seismicportal.eu/realtime.html",
  configSchema: Cfg,
  defaultConfig: { minMag: 2.5 },
  async run(ctx) {
    while (!ctx.signal.aborted) {
      try {
        const ws = new WebSocket("wss://www.seismicportal.eu/standing_order/websocket");
        ctx.signal.addEventListener("abort", () => ws.close());
        await new Promise<void>((resolve) => {
          ws.on("open", () => ctx.log("emsc connected"));
          ws.on("message", (raw) => {
            try {
              const msg = JSON.parse(raw.toString());
              const p = msg?.data?.properties;
              if (!p) return;
              if ((p.mag ?? 0) < ctx.config.minMag) return;
              const [lon, lat, depth] = msg.data.geometry?.coordinates ?? [0, 0, 0];
              ctx.emit({
                id: `emsc-${p.unid}`,
                category: "seismic",
                severity: p.mag >= 6 ? "extreme" : p.mag >= 5 ? "high" : "moderate",
                title: `M${p.mag.toFixed(1)} — ${p.flynn_region}`,
                summary: `Depth ${depth} km`,
                occurredAt: p.time ?? new Date().toISOString(),
                geo: { lat, lon, alt: -depth * 1000 },
                geoMentioned: p.flynn_region,
                icon: "waves",
                url: `https://www.emsc-csem.org/Earthquake/earthquake.php?id=${p.unid}`,
                payload: p,
              });
            } catch {
              /* ignore */
            }
          });
          ws.on("close", () => resolve());
          ws.on("error", (e) => {
            ctx.log(`emsc ws: ${(e as any).message}`);
            resolve();
          });
        });
      } catch (e: any) {
        if (!ctx.signal.aborted) ctx.log(`emsc: ${e.message}`);
      }
      if (!ctx.signal.aborted) await new Promise((r) => setTimeout(r, 5000));
    }
  },
});
