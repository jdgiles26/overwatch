export const FABRIC_BASE = "/fabric";

export async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(`${FABRIC_BASE}${path}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`GET ${path} ${r.status}`);
  return (await r.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${FABRIC_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} ${r.status}`);
  return (await r.json()) as T;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${FABRIC_BASE}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`PATCH ${path} ${r.status}`);
  return (await r.json()) as T;
}

export async function apiDelete(path: string): Promise<void> {
  const r = await fetch(`${FABRIC_BASE}${path}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`DELETE ${path} ${r.status}`);
}
