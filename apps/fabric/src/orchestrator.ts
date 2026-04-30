import type { Connector } from "@overwatch/connectors";
import { getConnectorById } from "@overwatch/connectors";
import type { ConnectorStatus, IngestEvent } from "@overwatch/schemas";
import { db, decrypt, encrypt, listInstances, persistEvent, upsertInstance, deleteInstance } from "./db.js";
import { EventEmitter } from "node:events";

type RunningInstance = {
  id: string;
  connector: Connector<any>;
  config: any;
  enabled: boolean;
  abort: AbortController;
  status: ConnectorStatus;
  buffer: number[];
};

export class Orchestrator extends EventEmitter {
  private instances = new Map<string, RunningInstance>();

  async start() {
    const rows = listInstances();
    if (rows.length === 0) {
      // no instances seeded — leave empty, seed.ts will handle
    }
    for (const row of rows) {
      const connector = getConnectorById(row.connectorId);
      if (!connector) continue;
      let cfg: any = {};
      try {
        cfg = JSON.parse(decrypt(row.config));
      } catch {
        cfg = connector.defaultConfig;
      }
      this.launch(row.id, connector, cfg, !!row.enabled, row.label);
    }
  }

  private launch(id: string, connector: Connector<any>, config: any, enabled: boolean, label: string) {
    const abort = new AbortController();
    const inst: RunningInstance = {
      id,
      connector,
      config,
      enabled,
      abort,
      buffer: [],
      status: {
        id,
        label,
        category: connector.category,
        authKind: connector.authKind,
        enabled,
        connected: false,
        eventsLastMinute: 0,
        eventsLastHour: 0,
        errors: [],
        configured: true,
      },
    };
    this.instances.set(id, inst);
    if (enabled) this.runOne(inst).catch(() => {});
    this.emitStatus();
  }

  private async runOne(inst: RunningInstance) {
    inst.status.connected = true;
    this.emitStatus();
    try {
      await inst.connector.run({
        config: inst.config,
        signal: inst.abort.signal,
        log: (msg) => {
          inst.status.errors = [msg, ...inst.status.errors].slice(0, 5);
          this.emitStatus();
        },
        emit: (ev) => {
          const full: IngestEvent = {
            ...ev,
            source: ev.source ?? inst.connector.label,
            connectorId: ev.connectorId ?? inst.connector.id,
            receivedAt: new Date().toISOString(),
            severity: (ev.severity as any) ?? "info",
          } as IngestEvent;
          persistEvent(full);
          inst.buffer.push(Date.now());
          this.emit("event", full);
          inst.status.lastEventAt = full.receivedAt;
        },
        now: () => new Date().toISOString(),
      });
    } catch (e: any) {
      inst.status.errors = [`run: ${e.message ?? e}`, ...inst.status.errors].slice(0, 5);
    } finally {
      inst.status.connected = false;
      this.emitStatus();
    }
  }

  addInstance(connectorId: string, label: string, config: any, enabled = true): string {
    const connector = getConnectorById(connectorId);
    if (!connector) throw new Error(`unknown connector ${connectorId}`);
    const id = `${connectorId}-${Date.now().toString(36)}`;
    upsertInstance({
      id,
      connectorId,
      label,
      enabled: enabled ? 1 : 0,
      config: encrypt(JSON.stringify(config)),
    });
    this.launch(id, connector, config, enabled, label);
    return id;
  }

  updateInstance(id: string, updates: { label?: string; config?: any; enabled?: boolean }) {
    const inst = this.instances.get(id);
    if (!inst) throw new Error("not found");
    if (updates.label) inst.status.label = updates.label;
    if (updates.config) inst.config = { ...inst.config, ...updates.config };
    if (updates.enabled !== undefined) {
      inst.enabled = updates.enabled;
      inst.status.enabled = updates.enabled;
      if (!updates.enabled) {
        inst.abort.abort();
      } else {
        inst.abort = new AbortController();
        this.runOne(inst).catch(() => {});
      }
    }
    upsertInstance({
      id,
      connectorId: inst.connector.id,
      label: inst.status.label,
      enabled: inst.enabled ? 1 : 0,
      config: encrypt(JSON.stringify(inst.config)),
    });
    this.emitStatus();
  }

  removeInstance(id: string) {
    const inst = this.instances.get(id);
    if (!inst) return;
    inst.abort.abort();
    this.instances.delete(id);
    deleteInstance(id);
    this.emitStatus();
  }

  allStatus(): ConnectorStatus[] {
    const now = Date.now();
    return [...this.instances.values()].map((i) => {
      i.buffer = i.buffer.filter((t) => now - t < 3_600_000);
      i.status.eventsLastMinute = i.buffer.filter((t) => now - t < 60_000).length;
      i.status.eventsLastHour = i.buffer.length;
      return { ...i.status };
    });
  }

  private emitStatus() {
    this.emit("status", this.allStatus());
  }

  stop() {
    for (const inst of this.instances.values()) inst.abort.abort();
  }
}

export const orchestrator = new Orchestrator();
