// Offline-Speicher für den Programmcode. Aufnahmen und Texte werden hier nie gespeichert oder gesendet.
const VERSION = "protokoll-v3";
// Kleine Dateien gleich beim Installieren; die großen onnxruntime-Dateien (vendor/…/*.wasm, ca. 27 MB)
// erst beim ersten Gebrauch (siehe fetch: vendor/ wird wie eine eigene Datei behandelt).
const SHELL = ["./", "./index.html", "./helpers.js", "./pcm-worklet.js",
  "./vendor/docx-9.11.0/index.iife.js", "./vendor/transformers-4.3.1/transformers.min.js"];
// Nur noch von niederschrift-probe.html genutzt (web-llm); index.html lädt nichts mehr von dort.
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
  // eigene Dateien (auch vendor/): erst Netz (neueste Version), ohne Netz aus dem Speicher
  const isVendor = url.pathname.includes("/vendor/");
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || (isVendor ? Response.error() : caches.match("./index.html"))))
  );
});
