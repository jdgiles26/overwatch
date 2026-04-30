import { z } from "zod";
import { defineConnector } from "../types.js";
import { sleep } from "../util.js";

const Cfg = z.object({
  intervalMs: z.number().default(8_000),
  locations: z
    .array(z.object({ lat: z.number(), lon: z.number(), label: z.string() }))
    .default([
      { lat: 38.9072, lon: -77.0369, label: "Washington DC" },
      { lat: 34.0522, lon: -118.2437, label: "Los Angeles" },
      { lat: 40.7128, lon: -74.006, label: "New York" },
      { lat: 51.5074, lon: -0.1278, label: "London" },
      { lat: 35.6762, lon: 139.6503, label: "Tokyo" },
      { lat: -33.8688, lon: 151.2093, label: "Sydney" },
    ]),
});

const icons = ["radio", "shield", "zap", "flame", "waves", "wind", "cloud"];
const categories = ["iot", "lightning", "fire", "seismic", "power", "water", "air"] as const;
const templates = [
  { title: "Sensor spike", severity: "moderate" as const },
  { title: "Perimeter breach attempt", severity: "high" as const },
  { title: "Voltage drop detected", severity: "low" as const },
  { title: "Motion in restricted zone", severity: "moderate" as const },
  { title: "Lightning strike detected", severity: "high" as const },
  { title: "Heartbeat OK", severity: "info" as const },
];

export const simulator = defineConnector<z.infer<typeof Cfg>>({
  id: "demo-simulator",
  label: "Demo Event Simulator",
  description: "Generates simulated IoT/environmental events for a zero-internet demo.",
  category: "iot",
  authKind: "none",
  freeTier: true,
  configSchema: Cfg,
  defaultConfig: {
    intervalMs: 8_000,
    locations: [
      { lat: 38.9072, lon: -77.0369, label: "Washington DC" },
      { lat: 34.0522, lon: -118.2437, label: "Los Angeles" },
      { lat: 40.7128, lon: -74.006, label: "New York" },
      { lat: 51.5074, lon: -0.1278, label: "London" },
      { lat: 35.6762, lon: 139.6503, label: "Tokyo" },
      { lat: -33.8688, lon: 151.2093, label: "Sydney" },
    ],
  },
  async run(ctx) {
    let seq = 0;
    while (!ctx.signal.aborted) {
      const locIdx = Math.floor(Math.random() * ctx.config.locations.length);
      const loc = ctx.config.locations[locIdx]!;
      const tIdx = Math.floor(Math.random() * templates.length);
      const t = templates[tIdx]!;
      const cIdx = Math.floor(Math.random() * categories.length);
      const cat = categories[cIdx]!;
      const iconIdx = Math.floor(Math.random() * icons.length);
      ctx.emit({
        id: `sim-${++seq}-${Date.now()}`,
        category: cat,
        severity: t.severity,
        title: t.title,
        summary: `${loc.label} • node-${(seq % 16) + 1}`,
        occurredAt: ctx.now(),
        geo: {
          lat: loc.lat + (Math.random() - 0.5) * 0.5,
          lon: loc.lon + (Math.random() - 0.5) * 0.5,
        },
        geoMentioned: loc.label,
        icon: icons[iconIdx],
        payload: { sim: true },
      });
      await sleep(ctx.config.intervalMs, ctx.signal);
    }
  },
});
