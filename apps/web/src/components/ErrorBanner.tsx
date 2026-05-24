"use client";
import { useStore } from "@/lib/store";
import { AlertOctagon, X } from "lucide-react";

export function ErrorBanner() {
  const errors = useStore((s) => s.errors);
  const dismissError = useStore((s) => s.dismissError);

  if (errors.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex justify-center px-3 pt-3"
      data-agent="error-banner"
      role="alert"
      aria-live="assertive"
    >
      <div className="pointer-events-auto flex w-full max-w-3xl flex-col gap-2">
        {errors.map((e) => (
          <div
            key={e.key}
            className="flex items-start gap-3 rounded-lg border border-threat-high/60 bg-threat-high/15 px-4 py-3 text-sm text-threat-high shadow-2xl backdrop-blur"
            data-agent={`error-${e.key}`}
          >
            <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="flex-1 leading-snug">
              <div className="font-semibold uppercase tracking-wide text-threat-high">
                {e.title}
              </div>
              <div className="mt-0.5 text-threat-high/90">{e.message}</div>
            </div>
            <button
              className="shrink-0 rounded p-1 opacity-70 transition hover:bg-white/10 hover:opacity-100"
              onClick={() => dismissError(e.key)}
              aria-label="Dismiss error"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
