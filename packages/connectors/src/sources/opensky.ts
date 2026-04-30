import { z } from "zod";
import { defineConnector } from "../types.js";
import { fetchJson, sleep } from "../util.js";

const Cfg = z.object({
  username: z.string().default(""),
  password: z.string().default(""),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).default([-125, 24, -66, 50]),
});

export const openSky = defineConnector<z.infer<typeof Cfg>>({
  id: "opensky",
  label: "OpenSky Flights (ADS-B)",
  description: "Live aircraft positions. Anonymous works but rate-limited; free account gives higher limits.",
  category: "transport",
  authKind: "api-key",
  freeTier: true,
  homepageUrl: "https://opensky-network.org",
  configSchema: Cfg,
  defaultConfig: { username: "", password: "", bbox: [-125, 24, -66, 50] },
  pollIntervalMs: 20_000,
  async run(ctx) {
    while (!ctx.signal.aborted) {
      try {
        const [lamin, lomin, lamax, lomax] = [
          ctx.config.bbox[1],
          ctx.config.bbox[0],
          ctx.config.bbox[3],
          ctx.config.bbox[2],
        ];
        const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
        const headers: Record<string, string> = {};
        if (ctx.config.username && ctx.config.password) {
          headers["Authorization"] =
            "Basic " + Buffer.from(`${ctx.config.username}:${ctx.config.password}`).toString("base64");
        }
        const data = await fetchJson(url, { headers, signal: ctx.signal });
        for (const s of data.states ?? []) {
          const [icao24, callsign, , , , lon, lat, , , vel, hdg, , , altGeo] = s;
          if (lat == null || lon == null) continue;
          ctx.emit({
            id: `flight-${icao24}-${data.time}`,
            category: "transport",
            severity: "info",
            title: `${(callsign ?? "").trim() || icao24}`,
            summary: `Heading ${Math.round(hdg ?? 0)}° at ${Math.round(((vel ?? 0) * 3.6))} km/h`,
            occurredAt: new Date(data.time * 1000).toISOString(),
            geo: { lat, lon, alt: altGeo ?? 0 },
            icon: "plane",
            payload: { icao24, callsign, velocity: vel, heading: hdg, altitude: altGeo },
          });
        }
      } catch (e: any) {
        if (!ctx.signal.aborted) ctx.log(`opensky: ${e.message}`);
      }
      await sleep(ctx.pollIntervalMs ?? 20_000, ctx.signal);
    }
  },
});
