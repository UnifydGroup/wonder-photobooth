// Caches the booth shell and branding images so the booth still opens if venue Wi-Fi drops.
const CACHE = "booth-v3";
const SHELL = ["/", "/config.js", "/frames.js", "/qrcode.js", "/manifest.webmanifest", "/icons/icon-180.png", "/icons/icon-192.png"];
const BRANDING = "/storage/v1/object/public/branding/";
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== "branding").map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Logos and frame overlays: file names never change, so cache-first
  if (url.pathname.startsWith(BRANDING)) {
    e.respondWith(caches.open("branding").then((c) => c.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }))));
    return;
  }
  if (url.origin !== location.origin || !SHELL.includes(url.pathname)) return;
  // App shell: network first, fall back to cache when offline
  e.respondWith(fetch(e.request).then((r) => {
    const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request)));
});
