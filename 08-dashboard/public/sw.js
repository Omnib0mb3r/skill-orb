/**
 * DevNeural Hub service worker.
 *
 * Phase 3.4.6 scaffold: install + activate + minimal fetch passthrough.
 * Phase 3.7 lands the push handler + VAPID subscription flow.
 *
 * SW_VERSION is rewritten by scripts/postbuild-sw-version.mjs after every
 * `next build` so the sw.js byte stream changes and the browser picks up
 * the new bundle without a manual unregister. Source value below is a
 * sentinel; the post-build pass replaces it with an ISO timestamp.
 */

const SW_VERSION = "__BUILD_VERSION__";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Push handler stub. Phase 3.7 wires real notification rendering.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "DevNeural", body: event.data.text() };
  }
  const title = payload.title || "DevNeural";
  const opts = {
    body: payload.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: payload.url || "/", id: payload.id, ts: Date.now() },
    tag: payload.tag || payload.id || "default",
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((wins) => {
      const existing = wins.find((w) => w.url.includes(target));
      if (existing) return existing.focus();
      return self.clients.openWindow(target);
    }),
  );
});
