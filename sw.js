// Offline-Speicher für den Programmcode. Aufnahmen und Texte werden hier nie gespeichert oder gesendet.
const VERSION = "protokoll-v2";
const SHELL = ["./", "./index.html", "./helpers.js", "./pcm-worklet.js"];
const CDN = "https://cdn.jsdelivr.net/";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k.startsWith("protokoll-")).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isCdn = req.url.startsWith(CDN);
  if (!sameOrigin && !isCdn) return; // Modelldateien verwaltet die Bibliothek selbst

  if (isCdn) {
    // feste Versionen: erst Speicher, sonst Netz (und merken)
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }
  // eigene Dateien: erst Netz (neueste Version), ohne Netz aus dem Speicher
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
  );
});
