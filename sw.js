
const CACHE = "roostercheck-v3";

const FILES = [
  "./",
  "./index.html",
  "./style.css?v=3",
  "./app.js?v=3",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// Nieuwe versie installeren
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(FILES))
  );

  self.skipWaiting();
});

// Oude caches verwijderen
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key =>
            key.startsWith("roostercheck-") &&
            key !== CACHE
          )
          .map(key => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});

// Eerst internet proberen, daarna cache
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Alleen eigen websitebestanden beheren
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();

          caches.open(CACHE).then(cache => {
            cache.put(event.request, copy);
          });
        }

        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);

        if (cached) return cached;

        return new Response(
          "Geen internetverbinding en geen opgeslagen versie beschikbaar.",
          {
            status: 503,
            headers: {
              "Content-Type": "text/plain; charset=utf-8"
            }
          }
        );
      })
  );
});
