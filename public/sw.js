// Service worker for the installable app.
//
// It deliberately caches NOTHING from the app or the database: every page,
// script and data request goes to the network exactly as it would without it,
// so a new deploy shows up on the next open and data is never stale.
// It only (1) shows a small "You're offline" page when a page can't load,
// and (2) shows push notifications and opens the right page when one is tapped.

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,sans-serif;background:#0c1222;color:#e2e8f0;text-align:center;padding:24px}
button{margin-top:16px;border:0;border-radius:10px;padding:10px 18px;font-weight:600;color:#fff;
background:linear-gradient(135deg,#5b5bf0,#8b5cf6)}</style></head><body><div>
<h1 style="font-size:20px;margin:0 0 8px">You're offline</h1>
<p style="margin:0;color:#94a3b8">Check your internet connection and try again.</p>
<button onclick="location.reload()">Try again</button></div></body></html>`;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Clear any caches an older version might have made.
      for (const key of await caches.keys()) await caches.delete(key);
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

// Only page loads are touched, and only to show the offline page on failure.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse;
        if (preloaded) return preloaded;
        return await fetch(event.request);
      } catch {
        return new Response(OFFLINE_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
    })(),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "New notification";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: data.tag || undefined,
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin) {
          await w.focus();
          if ("navigate" in w) return w.navigate(url).catch(() => self.clients.openWindow(url));
          return;
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});

// The browser can swap the push address; save the new one so alerts keep coming.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) w.postMessage({ type: "push-resubscribe" });
    })(),
  );
});
