export function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((res) => {
    const t = setTimeout(res, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      res();
    });
  });
}

export async function fetchJson(url: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(url, {
    ...init,
    headers: { "User-Agent": "overwatch/0.1 (demo)", accept: "application/json", ...(init.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

export async function fetchText(url: string, init: RequestInit = {}): Promise<string> {
  const r = await fetch(url, {
    ...init,
    headers: { "User-Agent": "overwatch/0.1 (demo)", ...(init.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

export function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
