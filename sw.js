/* SERVICE WORKER AMONK MONITOR (2026-09-23) — supaya aplikasi bisa dipasang di layar utama HP dan
 * tetap terbuka saat sinyal lemah.
 *  - Halaman & data (index.html, *.json): JARINGAN DULU, cadangan cache kalau offline -> selalu versi terbaru.
 *  - Ikon & manifest: CACHE DULU.
 *  - Permintaan ke domain lain (Binance, Cloudflare Worker, Telegram, TradingView) TIDAK disentuh sama sekali:
 *    harga, saldo, dan status bot selalu langsung dari sumbernya, tidak pernah dari cache. */
const CACHE = "amonk-v3";   // v3 2026-09-23: ikon AS MONITOR + penanda ?v=2 (paksa HP ambil ikon baru)
const INTI = ["./", "index.html", "manifest.webmanifest?v=2", "ikon-192.png?v=2", "ikon-512.png?v=2", "apple-touch-icon.png?v=2", "favicon-32.png?v=2"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(INTI)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return;           // domain lain: biarkan lewat
  const statis = /\.(png|webmanifest)$/.test(u.pathname);
  if (statis) { e.respondWith(caches.match(r).then(c => c || fetch(r))); return; }
  e.respondWith(fetch(r).then(res => {
    if (res.ok && (r.mode === "navigate" || /\.(html|json)$/.test(u.pathname) || u.pathname.endsWith("/"))) {
      const salin = res.clone(); caches.open(CACHE).then(c => c.put(r, salin));
    }
    return res;
  }).catch(() => caches.match(r).then(c => c || (r.mode === "navigate" ? caches.match("index.html") : undefined))));
});
