const CACHE_NAME = "worktime-pwa-v1";
const ASSETS = [
  "index.html",
  "dashboard.html",
  "absen.html",
  "riwayat.html",
  "styles.css",
  "app.js",
  "sw-register.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "favicon.ico",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const requests = ASSETS.map(
        (asset) => new Request(asset, { cache: "reload" })
      );
      const results = await Promise.allSettled(
        requests.map((request) => fetch(request))
      );
      await Promise.all(
        results.map((result, index) => {
          if (result.status !== "fulfilled") return null;
          const response = result.value;
          if (!response.ok) return null;
          return cache.put(requests[index], response.clone());
        })
      );
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      if (event.request.method !== "GET") return fetch(event.request);
      if (!event.request.url.startsWith("http")) return fetch(event.request);
      return fetch(event.request).then((response) => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return response;
      });
    })
  );
});
