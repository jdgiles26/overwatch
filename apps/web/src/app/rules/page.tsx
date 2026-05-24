"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  Plus,
  Save,
  Trash2,
  Volume2,
  Power,
} from "lucide-react";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { ensureNotifyPermission, playSound } from "@/lib/notify";
import { cn } from "@/lib/cn";
import { newRule as makeNewRule } from "@/lib/rules";

type Rule = {
  id: string;
  label: string;
  enabled: boolean;
  notify: {
    desktop: boolean;
    sound: boolean;
    soundKind: "chime" | "siren" | "tone" | "none";
    severityFloor: "info" | "low" | "moderate" | "high" | "extreme";
  };
  condition: {
    categories?: string[];
    minSeverity?: "info" | "low" | "moderate" | "high" | "extreme";
    keywords?: string[];
    bbox?: [number, number, number, number];
    nearLocationId?: string;
    nearKm?: number;
    rateLimitMs?: number;
  };
};

type Firing = {
  id: string;
  ruleId: string;
  ruleLabel: string;
  firedAt: string;
  reason: string;
  event?: any;
};

const CATS = [
  "weather",
  "seismic",
  "fire",
  "air",
  "transport",
  "power",
  "news",
  "iot",
  "cv",
  "space",
  "finance",
  "social",
  "other",
];
const SEVS = ["info", "low", "moderate", "high", "extreme"] as const;

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [firings, setFirings] = useState<Firing[]>([]);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [perm, setPerm] = useState<NotificationPermission | "unknown">("unknown");

  async function refresh() {
    const [r, f] = await Promise.all([
      apiGet<Rule[]>("/api/rules"),
      apiGet<Firing[]>("/api/firings?limit=50"),
    ]);
    setRules(r);
    setFirings(f);
  }

  useEffect(() => {
    refresh();
    if (typeof Notification !== "undefined") setPerm(Notification.permission);
  }, []);

  function newRule(): Rule {
    // Draft has no id; the server assigns one on POST. Keeps "create new"
    // distinct from "update existing"; before this fix, sending id="" caused
    // every new rule to overwrite the previous one via INSERT OR REPLACE.
    return makeNewRule() as Rule;
  }

  async function save(r: Rule) {
    await apiPost("/api/rules", r);
    setEditing(null);
    await refresh();
  }

  async function remove(id: string) {
    await apiDelete(`/api/rules/${id}`);
    await refresh();
  }

  return (
    <main className="grid min-h-screen grid-cols-[260px_1fr] bg-grid">
      <aside className="panel m-3 flex flex-col gap-2 p-3">
        <Link className="btn flex items-center gap-2" href="/">
          <ArrowLeft className="h-4 w-4" /> Back to OverWatch
        </Link>
        <Link className="btn flex items-center gap-2" href="/connectors">
          Connectors
        </Link>
        <div className="rounded bg-white/5 p-2 text-[11px] uppercase tracking-wider text-white/60">
          Notifications
        </div>
        <div className="text-xs text-white/70">
          Browser permission:{" "}
          <span
            className={
              perm === "granted"
                ? "text-accent-400"
                : perm === "denied"
                ? "text-threat-high"
                : "text-amber-300"
            }
          >
            {perm}
          </span>
        </div>
        <button
          className="btn flex items-center gap-2"
          onClick={async () => {
            const p = await ensureNotifyPermission();
            setPerm(p);
          }}
        >
          <Bell className="h-3.5 w-3.5" /> Request permission
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn" onClick={() => playSound("chime")}>
            <Volume2 className="h-3 w-3 inline" /> chime
          </button>
          <button className="btn" onClick={() => playSound("siren")}>
            siren
          </button>
          <button className="btn" onClick={() => playSound("tone")}>
            tone
          </button>
        </div>
        <div className="mt-3 rounded bg-white/5 p-2 text-[11px] uppercase tracking-wider text-white/60">
          Recent firings · {firings.length}
        </div>
        <div className="flex-1 overflow-auto">
          {firings.length === 0 ? (
            <div className="text-xs text-white/40">no firings yet</div>
          ) : (
            firings.map((f) => (
              <div key={f.id} className="mb-2 rounded bg-black/30 p-2 text-[11px]">
                <div className="font-semibold">{f.ruleLabel}</div>
                <div className="text-white/60">
                  {new Date(f.firedAt).toLocaleTimeString()}
                </div>
                <div className="line-clamp-2 text-white/80">
                  {f.event?.title ?? "(no event)"}
                </div>
                <div className="text-[10px] text-accent-300">{f.reason}</div>
              </div>
            ))
          )}
        </div>
      </aside>
      <section className="m-3 flex flex-col gap-3">
        <div className="panel flex items-center justify-between p-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-white/50">
              Alert rules
            </div>
            <div className="text-2xl font-bold">{rules.length} active</div>
          </div>
          <button
            className="btn flex items-center gap-2"
            onClick={() => setEditing(newRule())}
          >
            <Plus className="h-4 w-4" /> New rule
          </button>
        </div>
        <div className="panel flex-1 overflow-auto p-3">
          {rules.length === 0 ? (
            <div className="text-sm text-white/50">
              No rules yet. Click <strong>New rule</strong> to create one — for
              example: &ldquo;M5+ earthquake within 500km of San Francisco&rdquo; or &ldquo;any
              extreme event mentioning &lsquo;evacuation&rsquo;&rdquo;.
            </div>
          ) : (
            <ul className="space-y-2">
              {rules.map((r) => (
                <li
                  key={r.id}
                  className="flex items-start justify-between rounded border border-white/10 bg-black/30 p-3"
                >
                  <div>
                    <div className="flex items-center gap-2 text-sm">
                      <Power
                        className={cn(
                          "h-3.5 w-3.5",
                          r.enabled ? "text-accent-400" : "text-white/30",
                        )}
                      />
                      <strong>{r.label}</strong>
                    </div>
                    <div className="mt-1 text-[11px] text-white/60">
                      {r.condition.categories?.length
                        ? `cats=${r.condition.categories.join(",")} · `
                        : ""}
                      {r.condition.minSeverity
                        ? `≥${r.condition.minSeverity} · `
                        : ""}
                      {r.condition.keywords?.length
                        ? `kw="${r.condition.keywords.join(",")}" · `
                        : ""}
                      {r.condition.bbox ? `bbox · ` : ""}
                      {r.condition.nearLocationId
                        ? `≤${r.condition.nearKm}km of ${r.condition.nearLocationId} · `
                        : ""}
                      rate {Math.round((r.condition.rateLimitMs ?? 60_000) / 1000)}s
                    </div>
                    <div className="text-[11px] text-white/50">
                      notify: {r.notify.desktop ? "desktop" : "—"}{" "}
                      {r.notify.sound ? `+ ${r.notify.soundKind}` : "(silent)"}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn" onClick={() => setEditing(r)}>
                      Edit
                    </button>
                    <button
                      className="btn text-threat-high"
                      onClick={() => remove(r.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      {editing && (
        <RuleEditor
          rule={editing}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </main>
  );
}

function RuleEditor({
  rule,
  onSave,
  onClose,
}: {
  rule: Rule;
  onSave: (r: Rule) => void | Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Rule>({ ...rule });
  function toggleCat(c: string) {
    const cats = draft.condition.categories ?? [];
    setDraft({
      ...draft,
      condition: {
        ...draft.condition,
        categories: cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c],
      },
    });
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="panel w-[640px] max-w-full p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm uppercase tracking-wider text-white/60">
            {rule.id ? "Edit rule" : "New rule"}
          </div>
          <button className="btn" onClick={onClose}>
            close
          </button>
        </div>
        <label className="mb-2 block text-xs">
          Label
          <input
            className="input mt-1"
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          />
        </label>
        <div className="mb-2">
          <div className="mb-1 text-xs">Categories (any)</div>
          <div className="flex flex-wrap gap-1">
            {CATS.map((c) => {
              const on = (draft.condition.categories ?? []).includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCat(c)}
                  className={cn(
                    "rounded px-2 py-0.5 text-[11px]",
                    on
                      ? "bg-accent-400 text-black"
                      : "bg-white/10 text-white/70 hover:bg-white/20",
                  )}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>
        <div className="mb-2 grid grid-cols-2 gap-2">
          <label className="text-xs">
            Min severity
            <select
              className="input mt-1"
              value={draft.condition.minSeverity ?? "moderate"}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  condition: { ...draft.condition, minSeverity: e.target.value as any },
                })
              }
            >
              {SEVS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Rate limit (sec)
            <input
              className="input mt-1"
              type="number"
              value={Math.round((draft.condition.rateLimitMs ?? 60_000) / 1000)}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  condition: {
                    ...draft.condition,
                    rateLimitMs: Math.max(1, Number(e.target.value)) * 1000,
                  },
                })
              }
            />
          </label>
        </div>
        <label className="mb-2 block text-xs">
          Keywords (comma separated)
          <input
            className="input mt-1"
            value={(draft.condition.keywords ?? []).join(", ")}
            onChange={(e) =>
              setDraft({
                ...draft,
                condition: {
                  ...draft.condition,
                  keywords: e.target.value
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean),
                },
              })
            }
          />
        </label>
        <label className="mb-2 block text-xs">
          Bounding box (minLon,minLat,maxLon,maxLat)
          <input
            className="input mt-1"
            placeholder="-125,32,-114,42"
            value={draft.condition.bbox ? draft.condition.bbox.join(",") : ""}
            onChange={(e) => {
              const parts = e.target.value
                .split(",")
                .map((x) => Number(x.trim()));
              setDraft({
                ...draft,
                condition: {
                  ...draft.condition,
                  bbox:
                    parts.length === 4 && parts.every(Number.isFinite)
                      ? (parts as [number, number, number, number])
                      : undefined,
                },
              });
            }}
          />
        </label>
        <div className="mb-2 grid grid-cols-2 gap-2">
          <label className="text-xs">
            Near location id
            <input
              className="input mt-1"
              placeholder="loc_home"
              value={draft.condition.nearLocationId ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  condition: { ...draft.condition, nearLocationId: e.target.value || undefined },
                })
              }
            />
          </label>
          <label className="text-xs">
            Within km
            <input
              className="input mt-1"
              type="number"
              value={draft.condition.nearKm ?? 25}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  condition: { ...draft.condition, nearKm: Number(e.target.value) },
                })
              }
            />
          </label>
        </div>
        <div className="my-3 border-t border-white/10" />
        <div className="mb-2 text-xs uppercase tracking-wider text-white/60">
          Notification
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.notify.desktop}
              onChange={(e) =>
                setDraft({ ...draft, notify: { ...draft.notify, desktop: e.target.checked } })
              }
            />{" "}
            desktop notification
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.notify.sound}
              onChange={(e) =>
                setDraft({ ...draft, notify: { ...draft.notify, sound: e.target.checked } })
              }
            />{" "}
            sound
          </label>
          <label className="text-xs">
            Sound
            <select
              className="input mt-1"
              value={draft.notify.soundKind}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  notify: { ...draft.notify, soundKind: e.target.value as any },
                })
              }
            >
              <option value="chime">chime</option>
              <option value="siren">siren</option>
              <option value="tone">tone</option>
              <option value="none">silent</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            />{" "}
            enabled
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn bg-accent-400 text-black hover:bg-accent-300"
            onClick={() => onSave(draft)}
          >
            <Save className="h-3.5 w-3.5 inline" /> Save
          </button>
        </div>
      </div>
    </div>
  );
}
