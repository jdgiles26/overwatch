"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import {
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  Plus,
  Power,
  Trash2,
  X,
  PlugZap,
  Search,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/cn";

type CatalogItem = {
  id: string;
  label: string;
  description: string;
  category: string;
  authKind: string;
  freeTier: boolean;
  homepageUrl?: string;
  defaults: any;
  configFields: { key: string; kind: string; options?: string[]; default?: any; description?: string }[];
};

type StatusItem = {
  id: string;
  label: string;
  category: string;
  authKind: string;
  enabled: boolean;
  connected: boolean;
  eventsLastMinute: number;
  eventsLastHour: number;
  errors: string[];
};

export default function ConnectorsPage() {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [status, setStatus] = useState<StatusItem[]>([]);
  const [open, setOpen] = useState<CatalogItem | null>(null);
  const [draft, setDraft] = useState<any>({});
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [c, s] = await Promise.all([
      apiGet<CatalogItem[]>("/api/connectors/catalog"),
      apiGet<StatusItem[]>("/api/connectors/status"),
    ]);
    setCatalog(c);
    setStatus(s);
  }

  useEffect(() => {
    refresh().catch(() => {});
    const i = setInterval(() => refresh().catch(() => {}), 5000);
    return () => clearInterval(i);
  }, []);

  const grouped = useMemo(() => {
    const f = filter.toLowerCase();
    const arr = catalog.filter(
      (c) =>
        !f ||
        c.label.toLowerCase().includes(f) ||
        c.description.toLowerCase().includes(f) ||
        c.category.toLowerCase().includes(f),
    );
    const m = new Map<string, CatalogItem[]>();
    for (const c of arr) {
      const k = c.category.toUpperCase();
      const arr2 = m.get(k) ?? [];
      arr2.push(c);
      m.set(k, arr2);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [catalog, filter]);

  function startCreate(c: CatalogItem) {
    setOpen(c);
    setDraft({ ...c.defaults });
  }

  async function save() {
    if (!open) return;
    setBusy(true);
    try {
      await apiPost("/api/connectors", {
        connectorId: open.id,
        label: open.label,
        config: draft,
        enabled: true,
      });
      setOpen(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggle(s: StatusItem) {
    await apiPatch(`/api/connectors/${s.id}`, { enabled: !s.enabled });
    await refresh();
  }
  async function remove(s: StatusItem) {
    if (!confirm(`Remove ${s.label}?`)) return;
    await apiDelete(`/api/connectors/${s.id}`);
    await refresh();
  }

  return (
    <div className="min-h-screen bg-ink-950 px-6 py-5 text-sm">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="badge gap-1 hover:bg-white/10"
            data-agent="back-home"
          >
            <ArrowLeft className="h-3 w-3" /> Home
          </Link>
          <h1 className="text-lg font-semibold">Connectors</h1>
          <div className="ml-auto flex items-center gap-2 rounded-md border border-white/10 bg-ink-800/60 px-2">
            <Search className="h-3 w-3 text-white/40" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search…"
              className="bg-transparent py-1 text-xs outline-none"
            />
          </div>
        </div>

        <section className="panel p-3">
          <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-white/50">
            <PlugZap className="h-3 w-3" /> Active instances · {status.length}
          </div>
          {status.length === 0 ? (
            <div className="text-xs text-white/40">
              No instances configured. Add one below.
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
              {status.map((s) => (
                <li key={s.id} className="rounded-md border border-white/5 bg-ink-800/60 p-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        s.connected ? "bg-accent-400 animate-pulse" : "bg-white/30",
                      )}
                    />
                    <div className="flex-1 truncate font-medium">{s.label}</div>
                    <button
                      onClick={() => toggle(s)}
                      className={cn(
                        "rounded p-1",
                        s.enabled ? "text-accent-400" : "text-white/30",
                      )}
                      title="Toggle enabled"
                    >
                      <Power className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => remove(s)}
                      className="rounded p-1 text-white/50 hover:text-threat-high"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[10px] uppercase text-white/40">
                    <span>{s.category}</span>
                    <span>{s.authKind}</span>
                    <span className="ml-auto tabular-nums">
                      {s.eventsLastMinute}/m · {s.eventsLastHour}/h
                    </span>
                  </div>
                  {s.errors.length > 0 && (
                    <div className="mt-1 text-[10px] text-threat-high">{s.errors[0]}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel p-3">
          <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-white/50">
            <CheckCircle2 className="h-3 w-3" /> Catalog · {catalog.length} sources
          </div>
          {grouped.map(([cat, items]) => (
            <div key={cat} className="mb-3">
              <div className="mb-1 text-[11px] uppercase tracking-wider text-white/40">
                {cat}
              </div>
              <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                {items.map((c) => (
                  <li
                    key={c.id}
                    className="rounded-md border border-white/5 bg-ink-800/40 p-2"
                  >
                    <div className="flex items-center gap-2">
                      <CircleDot className="h-3 w-3 text-accent-400" />
                      <div className="flex-1 truncate font-medium">{c.label}</div>
                      <span className="badge text-[9px]">{c.authKind}</span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-[11px] text-white/50">
                      {c.description}
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      {c.homepageUrl ? (
                        <a
                          href={c.homepageUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-white/40 hover:text-accent-400"
                        >
                          docs ↗
                        </a>
                      ) : (
                        <span />
                      )}
                      <button
                        onClick={() => startCreate(c)}
                        className="flex items-center gap-1 rounded bg-accent-500/15 px-2 py-0.5 text-[10px] text-accent-400 hover:bg-accent-500/25"
                        data-agent={`add-${c.id}`}
                      >
                        <Plus className="h-3 w-3" /> Add
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        {open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
            <div className="panel w-[520px] max-w-[95vw] p-4">
              <div className="mb-3 flex items-center gap-2">
                <Activity className="h-4 w-4 text-accent-400" />
                <div className="font-semibold">{open.label}</div>
                <button onClick={() => setOpen(null)} className="ml-auto">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mb-3 text-xs text-white/60">{open.description}</div>
              <div className="grid grid-cols-2 gap-2">
                {open.configFields.map((f) => (
                  <div
                    key={f.key}
                    className={cn(
                      f.kind === "array" || f.kind === "object" || f.kind === "tuple" || f.kind === "record"
                        ? "col-span-2"
                        : "",
                    )}
                  >
                    <div className="mb-1 text-[10px] uppercase tracking-wider text-white/50">
                      {f.key}
                    </div>
                    {renderField(f, draft[f.key], (v) => setDraft({ ...draft, [f.key]: v }))}
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => setOpen(null)} className="text-xs text-white/60">
                  Cancel
                </button>
                <button
                  disabled={busy}
                  onClick={save}
                  data-agent="save-connector"
                  className="rounded bg-accent-500/20 px-3 py-1.5 text-xs text-accent-400 hover:bg-accent-500/30 disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save & Start"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function renderField(
  f: { key: string; kind: string; options?: string[] },
  value: any,
  onChange: (v: any) => void,
) {
  if (f.kind === "boolean")
    return (
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
        {String(!!value)}
      </label>
    );
  if (f.kind === "number")
    return (
      <input
        type="number"
        value={value ?? 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="input"
      />
    );
  if (f.kind === "enum")
    return (
      <select
        className="input"
        value={value ?? f.options?.[0]}
        onChange={(e) => onChange(e.target.value)}
      >
        {f.options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  if (f.kind === "array" || f.kind === "tuple" || f.kind === "object" || f.kind === "record")
    return (
      <textarea
        className="input min-h-[60px] font-mono text-[11px]"
        value={value ? JSON.stringify(value, null, 2) : ""}
        onChange={(e) => {
          try {
            onChange(JSON.parse(e.target.value));
          } catch {
            /* keep typing */
          }
        }}
      />
    );
  return (
    <input
      type={f.key.toLowerCase().includes("password") || f.key.toLowerCase().includes("key") ? "password" : "text"}
      className="input"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
