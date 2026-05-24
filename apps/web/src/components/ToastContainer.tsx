"use client";
import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { AlertTriangle, Info, X, AlertCircle, CheckCircle2 } from "lucide-react";

const SEVERITY_STYLES: Record<
  string,
  { wrap: string; icon: React.ComponentType<{ className?: string }> }
> = {
  info: {
    wrap: "border-accent-400/40 bg-accent-400/10 text-accent-100",
    icon: Info,
  },
  warning: {
    wrap: "border-yellow-400/40 bg-yellow-400/10 text-yellow-100",
    icon: AlertTriangle,
  },
  error: {
    wrap: "border-threat-high/50 bg-threat-high/15 text-threat-high",
    icon: AlertCircle,
  },
  success: {
    wrap: "border-emerald-400/40 bg-emerald-400/10 text-emerald-100",
    icon: CheckCircle2,
  },
};

export function ToastContainer() {
  const toasts = useStore((s) => s.toasts);
  const pruneToasts = useStore((s) => s.pruneToasts);
  const dismissToast = useStore((s) => s.dismissToast);

  useEffect(() => {
    if (toasts.length === 0) return;
    const id = window.setInterval(pruneToasts, 500);
    return () => window.clearInterval(id);
  }, [toasts.length, pruneToasts]);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[320px] flex-col gap-2"
      data-agent="toast-container"
    >
      {toasts.map((t) => {
        const style = SEVERITY_STYLES[t.severity] ?? SEVERITY_STYLES.info!;
        const Icon = style.icon;
        return (
          <div
            key={t.id}
            className={
              "pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-xs shadow-xl backdrop-blur " +
              style.wrap
            }
            role="status"
            data-agent={`toast-${t.severity}`}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1 leading-snug">{t.message}</div>
            <button
              className="shrink-0 rounded p-0.5 opacity-60 transition hover:bg-white/10 hover:opacity-100"
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
