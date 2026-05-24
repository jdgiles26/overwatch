export type ToastSeverity = "info" | "warning" | "error" | "success";

export type Toast = {
  id: string;
  message: string;
  severity: ToastSeverity;
  expiresAt: number;
};

export type CreateToastInput = {
  message: string;
  severity?: ToastSeverity;
  ttlMs?: number;
};

let _counter = 0;
function nextToastId(): string {
  _counter += 1;
  return `toast-${_counter}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createToast(input: CreateToastInput, nowMs: number): Toast {
  if (!input.message || input.message.trim() === "") {
    throw new Error("Toast message must be non-empty");
  }
  const severity: ToastSeverity = input.severity ?? "info";
  const ttl = input.ttlMs ?? 5000;
  return {
    id: nextToastId(),
    message: input.message,
    severity,
    expiresAt: nowMs + ttl,
  };
}

export function removeToastById(list: Toast[], id: string): Toast[] {
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return list;
  return list.filter((t) => t.id !== id);
}

export function pruneExpiredToasts(list: Toast[], nowMs: number): Toast[] {
  const survivors = list.filter((t) => t.expiresAt > nowMs);
  if (survivors.length === list.length) return list;
  return survivors;
}
