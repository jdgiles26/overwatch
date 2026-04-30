import { z } from "zod";
import mqtt from "mqtt";
import { defineConnector } from "../types.js";

const Cfg = z.object({
  url: z.string().default("wss://broker.hivemq.com:8884/mqtt"),
  topics: z.array(z.string()).default(["overwatch/demo/#"]),
  username: z.string().default(""),
  password: z.string().default(""),
  category: z
    .enum(["iot", "weather", "seismic", "air", "transport", "power", "water", "news", "cv", "space", "finance", "social", "fire", "lightning", "health", "other"])
    .default("iot"),
});

export const mqttGeneric = defineConnector<z.infer<typeof Cfg>>({
  id: "mqtt-generic",
  label: "Generic MQTT",
  description: "Subscribe to MQTT topics over WS/WSS. Works with HiveMQ, EMQX, Mosquitto, HomeAssistant.",
  category: "iot",
  authKind: "mqtt",
  freeTier: true,
  homepageUrl: "https://www.hivemq.com/mqtt/public-mqtt-broker/",
  configSchema: Cfg,
  defaultConfig: {
    url: "wss://broker.hivemq.com:8884/mqtt",
    topics: ["overwatch/demo/#"],
    username: "",
    password: "",
    category: "iot",
  },
  async run(ctx) {
    return new Promise<void>((resolve) => {
      const client = mqtt.connect(ctx.config.url, {
        username: ctx.config.username || undefined,
        password: ctx.config.password || undefined,
        reconnectPeriod: 3000,
        rejectUnauthorized: false,
      });

      const cleanup = () => {
        try {
          client.end(true);
        } catch {
          /* ignore */
        }
        resolve();
      };

      ctx.signal.addEventListener("abort", cleanup);
      client.on("connect", () => {
        for (const t of ctx.config.topics) client.subscribe(t, { qos: 0 });
        ctx.log(`mqtt connected ${ctx.config.url}`);
      });
      client.on("error", (e) => ctx.log(`mqtt error: ${e.message}`));
      client.on("message", (topic, payload) => {
        let data: any = payload.toString();
        try {
          data = JSON.parse(data);
        } catch {
          /* plain string */
        }
        const geo =
          data && typeof data === "object" && typeof data.lat === "number" && typeof data.lon === "number"
            ? { lat: data.lat, lon: data.lon }
            : undefined;
        ctx.emit({
          id: `mqtt-${topic}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          category: ctx.config.category,
          severity:
            typeof data === "object" && data?.severity && ["low", "moderate", "high", "extreme"].includes(data.severity)
              ? data.severity
              : "info",
          title: typeof data === "object" && data?.title ? data.title : `MQTT ${topic}`,
          summary: typeof data === "string" ? data : JSON.stringify(data).slice(0, 240),
          occurredAt: ctx.now(),
          geo,
          icon: "radio",
          payload: typeof data === "object" ? data : { raw: data },
        });
      });
    });
  },
});
