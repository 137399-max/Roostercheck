
const CACHE = "roostercheck-v16";

const FILES = [
  "./",
  "./index.html",
  "./style.css?v=16",
  "./app.js?v=16",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(FILES))
  );

  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys =>
        Promise.all(
          keys
            .filter(key =>
              key.startsWith("roostercheck-") && key !== CACHE
            )
            .map(key => caches.delete(key))
        )
      ),
      self.clients.claim()
    ])
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache =>
            cache.put(event.request, copy)
          );
        }

        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);

        return cached || new Response(
          "Geen internetverbinding.",
          { status: 503 }
        );
      })
  );
});

// PUSHMELDING ONTVANGEN
self.addEventListener("push", event => {
  let payload = {};

  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }

  if (!payload || typeof payload !== "object") {
    payload = {};
  }

  const title = payload.title || "Roostercheck";
  const options = {
    body: payload.body || "Er is iets veranderd in je rooster.",
    icon: payload.icon || "./icons/icon-192.png",
    badge: payload.badge || "./icons/icon-192.png",
    tag: payload.tag || "roostercheck",
    renotify: true,
    data: { url: payload.url || "./" },
    timestamp: Date.now()
  };

  event.waitUntil(
    (async () => {
      // Staat de app open en zichtbaar? Dan regelt de app zelf de
      // melding (realtime chat of de roostercontrole).
      const clientList = await self.clients
        .matchAll({
          type: "window",
          includeUncontrolled: true
        })
        .catch(() => []);

      if (
        clientList.some(client => client.visibilityState === "visible")
      ) {
        return;
      }

      await self.registration.showNotification(title, options);
    })()
  );
});

// DE PUSHINSCHRIJVING IS VERLOREN GEGAAN
self.addEventListener("pushsubscriptionchange", event => {
  event.waitUntil(
    self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then(clientList => {
      for (const client of clientList) {
        client.postMessage({ type: "push-subscription-change" });
      }
    })
  );
});

// OP EEN MELDING TIKKEN
self.addEventListener("notificationclick", event => {
  event.notification.close();

  const targetUrl = new URL(
    (event.notification.data && event.notification.data.url) || "./",
    self.registration.scope
  ).href;

  event.waitUntil(
    self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then(clientList => {
      for (const client of clientList) {
        if (
          "focus" in client &&
          client.url.startsWith(self.registration.scope)
        ) {
          return client.focus().then(focused => {
            focused.postMessage({ type: "open-url", url: targetUrl });
            return focused;
          });
        }
      }

      return self.clients.openWindow(targetUrl);
    })
  );
});
