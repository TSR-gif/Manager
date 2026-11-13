// Minimal service worker: makes the app installable and shows an offline page.
const CACHE = "manager-v1";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/offline.html"])));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("/offline.html")));
  }
});
self.addEventListener("push", (e) => {
  const data = e.data ? e.data.json() : { title: "Manager", body: "" };
  e.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: "/icon-192.png", data: data.url }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow(e.notification.data || "/approvals"));
});
