import { z } from "zod";
import { defineConnector } from "../types.js";
import { fetchJson, sleep } from "../util.js";

const Cfg = z.object({
  locations: z
    .array(z.object({ label: z.string(), lat: z.number(), lon: z.number() }))
    .default([
      { label: "Washington DC", lat: 38.9, lon: -77.03 },
      { label: "San Francisco", lat: 37.77, lon: -122.41 },
    ]),
});

export const openMeteo = defineConnector<z.infer<typeof Cfg>>({
  id: "open-meteo",
  label: "Open-Meteo Weather",
  description: "Free weather forecast API, no key required.",
  category: "weather",
  authKind: "none",
  freeTier: true,
  homepageUrl: "https://open-meteo.com/",
  configSchema: Cfg,
  defaultConfig: {
    locations: [
      { label: "Washington DC", lat: 38.9, lon: -77.03 },
      { label: "San Francisco", lat: 37.77, lon: -122.41 },
    ],
  },
  pollIntervalMs: 10 * 60_000,
  async run(ctx) {
    while (!ctx.signal.aborted) {
      for (const loc of ctx.config.locations) {
        try {
          const d = await fetchJson(
            `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,wind_speed_10m,weather_code,relative_humidity_2m`,
            { signal: ctx.signal },
          );
          const c = d.current ?? {};
          ctx.emit({
            id: `meteo-${loc.label}-${c.time}`,
            category: "weather",
            severity: c.wind_speed_10m > 40 ? "moderate" : "info",
            title: `${loc.label}: ${c.temperature_2m}°C, wind ${c.wind_speed_10m} km/h`,
            summary: `Humidity ${c.relative_humidity_2m}% • code ${c.weather_code}`,
            occurredAt: c.time ? new Date(c.time).toISOString() : ctx.now(),
            geo: { lat: loc.lat, lon: loc.lon },
            geoMentioned: loc.label,
            icon: "cloud",
            payload: d,
          });
        } catch (e: any) {
          if (!ctx.signal.aborted) ctx.log(`open-meteo: ${e.message}`);
        }
      }
      await sleep(ctx.pollIntervalMs ?? 600_000, ctx.signal);
    }
  },
});
