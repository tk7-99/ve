const CACHE_NAME = "dazza-cosmos-shell-v1";
const APP_SHELL = ["/", "/manifest.webmanifest", "/dazza-icon.svg"];
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("dazza-cosmos-") && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const isShellAsset = url.pathname === "/" || url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/dazza-icon.svg" || url.pathname.startsWith("/assets/");
  if (!isShellAsset) return;
  if (url.pathname === "/") {
    event.respondWith(
      fetch(request).then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
        return response;
      }).catch(async () => (await caches.match(request)) || Response.error())
    );
    return;
  }
  event.respondWith(
    caches.match(request).then(cached => {
      const update = fetch(request).then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
        return response;
      });
      return cached || update;
    })
  );
});
self.addEventListener("message", event => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
