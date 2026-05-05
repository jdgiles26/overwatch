# PWA

Overwatch is installable as a Progressive Web App. The dashboard ships a minimal manifest, an offline-tolerant service worker, and a tiny `PwaRegister` component that registers the worker on first load. There is no Workbox, no PWA build plugin — every piece is hand-written and lives under 50 lines of code.

## Surface area

| Concern | File |
|---|---|
| Manifest | `apps/web/public/manifest.webmanifest` |
| Service worker | `apps/web/public/sw.js` |
| App icon | `apps/web/public/icon.svg` |
| Registration | `apps/web/src/components/PwaRegister.tsx` |
| Mount + viewport | `apps/web/src/app/layout.tsx` |

## manifest.webmanifest

```json
{
  "name": "OverWatch",
  "short_name": "OverWatch",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#05070a",
  "theme_color": "#0b1e1e",
  "description": "Tactical OSINT + IoT data fabric with on-device AI",
  "icons": [
    { "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml" }
  ]
}
```

Properties that matter:

- **`start_url: "/"`** — the dashboard, not a marketing landing page. There isn't a marketing page.
- **`display: "standalone"`** — when installed, the app opens in a chromeless window. The system title bar is gone but the OS frame remains.
- **`background_color: "#05070a"`** — the same near-black ink the body uses, so there is no flash during the initial paint.
- **`theme_color: "#0b1e1e"`** — the colour the OS paints around the system UI on Android Chrome and the title bar on macOS PWA windows. It deliberately differs from the background so the chrome edge is visible.
- **One SVG icon at `sizes: "any"`.** No 192/512 PNG bundle. iOS Safari may not honour SVG-only manifests for the home-screen icon (it falls back to a rendered screenshot); the trade-off was accepted to keep the public folder minimal.

## icon.svg

A 64×64 SVG of concentric rings on the accent green (`#5cf0c9`) over the same near-black background as the manifest:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <radialGradient id="g" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#5cf0c9"/>
      <stop offset="100%" stop-color="#0b3b3b"/>
    </radialGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="#05070a"/>
  <circle cx="32" cy="32" r="22" fill="url(#g)" opacity="0.7"/>
  <circle cx="32" cy="32" r="22" fill="none" stroke="#5cf0c9" stroke-width="1.5"/>
  <!-- two more rings + crosshair lines + centre dot -->
</svg>
```

Rendered, it reads as "radar/sonar". The rounded `rx="14"` matches the iOS/Android squircle convention so the OS doesn't need to mask it.

## sw.js

```js
const CACHE = "overwatch-shell-v1";
const SHELL = ["/", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => null));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/fabric/") || url.pathname.startsWith("/api/")) return;
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    }),
  );
});
```

Properties:

- **Cache name `"overwatch-shell-v1"`.** Bumping the suffix invalidates the cache. Today no other cache version exists; new shells just write into v1 alongside old entries.
- **Pre-cached shell** is `["/", "/icon.svg", "/manifest.webmanifest"]`. Three assets — enough that opening the URL while offline shows the dashboard skeleton (Next.js JS chunks are not pre-cached but get cached on first fetch via the runtime path).
- **`skipWaiting()` + `clients.claim()`.** A new worker takes over immediately on install, no "reload required" banner.
- **Fetch strategy is "stale-while-revalidate" for GET non-API requests.** The cached response is served immediately; in parallel, the network is hit and the cache is updated. If the network fails and there's a cached entry, the cached entry is returned. If both fail, the request errors.
- **Two pass-through bypasses.**
  - `/fabric/*` is the proxy to the Fastify fabric — must be live, never cached.
  - `/api/*` is the (currently unused) Next.js API route prefix — same treatment.
- **Method filter.** Only `GET` is intercepted. POSTs (e.g. `/fabric/api/cv-event`) hit the network directly.
- **Push handler stub.** A `push` event with arbitrary text payload triggers `self.registration.showNotification("OverWatch", { body: data, icon: "/icon.svg" })`. There is no server today that pushes to this endpoint — it's an unused stub for future Push API integration.
- **`notificationclick` handler.** Closing the toast opens `/` in a new tab/window via `clients.openWindow("/")`.

The cache copy is `res.clone()` because the response body is a stream that can only be consumed once. Without the clone, returning `res` while also putting it into the cache would race for the same body.

## Registration

`apps/web/src/components/PwaRegister.tsx`:

```tsx
"use client";
import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch(() => undefined);
  }, []);
  return null;
}
```

Three guards:

- **`typeof navigator === "undefined"`** — no-op during SSR.
- **`"serviceWorker" in navigator`** — Safari Private Browsing, older browsers.
- **Catch-and-ignore** — registration failures are silent. The dashboard still works without a worker; offline support is the only thing lost.

The component renders `null` so it has no DOM presence.

## layout.tsx mount

`apps/web/src/app/layout.tsx`:

```tsx
export const metadata: Metadata = {
  title: "OverWatch — Real-Time Situational Awareness",
  description: "OSINT, IoT, and CV fabric with 3D globe, WebGPU AI analyst, and autonomous browser agent.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0b1e1e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">
        <ConsoleFilter />
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
```

Things to note:

- **`metadata.manifest`** — Next.js 15's metadata API emits the `<link rel="manifest" href="/manifest.webmanifest">` tag automatically.
- **`metadata.icons.icon`** — same automation for the favicon `<link>`.
- **`viewport.themeColor`** — emits `<meta name="theme-color" content="#0b1e1e">`.
- **`<html className="dark">`** — Tailwind dark mode is enabled at the root; the design system is a single-mode dark theme, so `dark` is hard-coded rather than driven by media query.
- **`<PwaRegister />` mounts in the body.** It needs to be a client component (it uses `useEffect`); putting it in `<head>` would force Next.js to handle hydration differently.
- **`<ConsoleFilter />`** is the partner of `apps/web/src/lib/ai.ts → installConsoleFilter`. It's an empty client component that runs the same patch from the React tree, ensuring the filter is installed even on routes that don't import the AI library. See [features/ai-analyst](./ai-analyst.md).

## Install prompt

There is no custom "Install OverWatch" button. Browsers that support PWAs surface their own install affordance:

- Chrome/Edge desktop — install icon in the address bar.
- Chrome Android — "Add to Home Screen" banner triggered by the `beforeinstallprompt` event (which OverWatch does not intercept).
- iOS Safari — "Add to Home Screen" via the share sheet.

Once installed, the app opens via the `start_url: "/"` and is rendered in `display: "standalone"` mode. There is no detection of standalone mode in the React code — the dashboard layout is the same in-browser and in-PWA.

## Offline behaviour

With the worker active, opening the app while offline produces:

- **Static shell loads from cache.** `/`, `/icon.svg`, `/manifest.webmanifest`, plus any Next.js chunks that were cached on previous fetches.
- **WebSocket fails.** `apps/web/src/lib/ws.ts` enters its exponential-backoff loop (capped at 15 s) and the TopBar's `FABRIC OFFLINE` indicator flips on.
- **`/fabric/api/*` requests fail.** The Connectors page, Rules page, Locations and Cameras lists all show empty states until the network returns.
- **Analyst LLM still works.** Once the model is in the IndexedDB cache (Transformers.js's `useBrowserCache`), the analyst can run against cached state. The `buildContext` snapshot uses whatever events are in the Zustand store from the last live session.
- **Maps render without tiles.** Cesium's OSM imagery and MapLibre's basemap both fail to load; the globe renders a black sphere with the entity dots that were already in the store.

There is no service-worker-backed background sync, no IndexedDB queue for failed POSTs. Offline edits are lost.

## Updating the worker

The worker doesn't watch for updates explicitly. Browsers re-fetch `/sw.js` on page load (with a max-age of 24 hours by default) and install a new worker if the bytes differ. Because both `skipWaiting()` and `clients.claim()` are called, the new worker takes over without a reload.

To force a clean cache during development, bump `CACHE = "overwatch-shell-v1"` to `"v2"` and the worker's activate handler should clear old entries — but the current code does *not* delete old caches. A maintainer who needs that behaviour can add:

```js
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});
```

## Limits worth knowing

- **No PNG icon.** SVG-only manifests are nominally supported but iOS still synthesises a screenshot icon for the home screen. Add 192/512 PNGs if installing on iPhone.
- **No "offline" UI.** The TopBar's `FABRIC OFFLINE` is the only signal. There's no "you're offline, here's what's cached" banner.
- **No background sync.** Closing the tab while offline loses any in-flight state.
- **The shell list is tiny.** Three pre-cached entries means the first offline open is graceful only because Next.js's chunks were cached on previous fetches. A first-ever offline visit (impossible by definition) would not work.
- **`/api/*` and `/fabric/*` are excluded from caching.** This is correct (live data should never be stale-served), but it does mean an offline session shows no events at all unless the WebSocket happened to populate the store earlier.
- **The push handler is an unused stub.** No server registers subscriptions; the push pipeline is decorative until that exists.

## Related pages

- [apps/web § Boot sequence](../apps/web.md) — `PwaRegister` is the second mount after `ConsoleFilter`.
- [features/alert-rules](./alert-rules.md) — alert toasts use the browser's `Notification` API, not the service worker's `push` path.
- [overview/architecture](../overview/architecture.md) — the worker is the only piece running off the main thread on the browser side besides `cvWorker`/`topicWorker`.
