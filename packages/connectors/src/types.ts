import type { z } from "zod";
import type {
  ConnectorDefinition,
  EventCategory,
  IngestEvent,
  ConnectorAuthKind,
} from "@overwatch/schemas";

export interface ConnectorCtx<TCfg = unknown> {
  config: TCfg;
  signal: AbortSignal;
  log: (msg: string, extra?: unknown) => void;
  emit: (
    event: Omit<IngestEvent, "receivedAt" | "connectorId" | "source"> & {
      connectorId?: string;
      source?: string;
    },
  ) => void;
  now: () => string;
  pollIntervalMs?: number;
}

export interface Connector<TCfg = any> {
  id: string;
  label: string;
  description: string;
  category: EventCategory;
  authKind: ConnectorAuthKind;
  homepageUrl?: string;
  docsUrl?: string;
  freeTier: boolean;
  configSchema: z.ZodTypeAny;
  defaultConfig: TCfg;
  pollIntervalMs?: number;
  run: (ctx: ConnectorCtx<TCfg>) => Promise<void>;
}

export function defineConnector<TCfg>(c: Connector<TCfg>): Connector<TCfg> {
  return c;
}

export function toDefinition(c: Connector): ConnectorDefinition {
  return {
    id: c.id,
    label: c.label,
    description: c.description,
    category: c.category,
    authKind: c.authKind,
    configSchema: c.configSchema,
    homepageUrl: c.homepageUrl,
    docsUrl: c.docsUrl,
    freeTier: c.freeTier,
  };
}

export function genId(): string {
  const rnd = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rnd}`;
}
