import { z } from "zod";
import { defineConnector } from "../types.js";

const Cfg = z.object({
  key: z.string().default("demo"),
  category: z
    .enum(["iot", "weather", "seismic", "air", "transport", "power", "water", "news", "cv", "drone", "space", "finance", "social", "fire", "lightning", "health", "other"])
    .default("iot"),
});

declare global {
  var __overwatchWebhookRouter: Map<string, (body: any) => void> | undefined;
}

export function getWebhookRouter(): Map<string, (body: any) => void> {
  if (!globalThis.__overwatchWebhookRouter) {
    globalThis.__overwatchWebhookRouter = new Map();
  }
  return globalThis.__overwatchWebhookRouter;
}

export const webhook = defineConnector<z.infer<typeof Cfg>>({
  id: "webhook",
  label: "Generic Webhook",
  description: "POST JSON to /ingest/:key. Use for LoRaWAN TTN, Zapier, custom devices.",
  category: "iot",
  authKind: "webhook",
  freeTier: true,
  configSchema: Cfg,
  defaultConfig: { key: "demo", category: "iot" },
  async run(ctx) {
    const router = getWebhookRouter();
    const handler = (body: any) => {
      const geo =
        body && typeof body === "object" && typeof body.lat === "number" && typeof body.lon === "number"
          ? { lat: body.lat, lon: body.lon }
          : undefined;
      ctx.emit({
        id: `wh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        category: ctx.config.category,
        severity: body?.severity ?? "info",
        title: body?.title ?? `Webhook ${ctx.config.key}`,
        summary: typeof body === "string" ? body : (body?.summary ?? JSON.stringify(body)).slice(0, 240),
        occurredAt: body?.occurredAt ?? ctx.now(),
        geo,
        icon: "webhook",
        payload: body,
      });
    };
    router.set(ctx.config.key, handler);
    await new Promise<void>((r) => ctx.signal.addEventListener("abort", () => r()));
    router.delete(ctx.config.key);
  },
});
