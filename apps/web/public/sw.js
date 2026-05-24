// Minimal OverWatch service worker.
// Network-first for API, cache shell for offline.
const CACHE = "overwatch-shell-v2";
const SHELL = ["/", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => null));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    Promise.all([
      // Drop old SW versions' caches so a SHELL bump invalidates cleanly.
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
      self.clients.claim(),
    ]),
  );
});

// Only cache responses we're actually allowed to put in CacheStorage:
// - Method must be GET (already filtered above).
// - Status must be 200. The Cache API explicitly rejects 206 (Partial Content,
//   used for HLS / range requests / large Cesium worker chunks) and would
//   throw `TypeError: Failed to execute 'put' on 'Cache': Partial response
//   (status code 206) is unsupported`.
// - Opaque (status 0) responses can be put but are useless to cache.
function isCacheable(res) {
  return res && res.ok && res.status === 200 && res.type === "basic";
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/fabric/") || url.pathname.startsWith("/api/")) return;
  if (e.request.method !== "GET") return;
  // Don't intercept Range requests (video / Cesium streamed workers).
  if (e.request.headers.get("range")) return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request)
        .then((res) => {
          if (isCacheable(res)) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => null);
          }
          return res;
        })
        .catch(() => cached || Response.error());
      return cached || fetchPromise;
    }),
  );
});
self.addEventListener("push", (e) => {
  const data = e.data ? e.data.text() : "OverWatch alert";
  e.waitUntil(
    self.registration.showNotification("OverWatch", { body: data, icon: "/icon.svg" }),
  );
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow("/"));
});
