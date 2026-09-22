/**
 * PERANTARA BINANCE BER-IP TETAP untuk bot AMONK (mode akun asli).
 *
 * Kenapa perlu (2026-09-22): Binance MENGHAPUS kunci API yang punya izin trading tanpa daftar IP tepercaya.
 * Bot berjalan di Cloudflare Workers yang IP-nya berubah-ubah, jadi permintaan bertanda-tangan diteruskan
 * lewat server kecil (VPS) ber-IP tetap ini; IP VPS itulah yang didaftarkan di kunci Binance.
 *
 * DESAIN KEAMANAN
 *  - Kunci API ASLI hanya ada DI SERVER INI (berkas /etc/amonk-proksi.env, chmod 600). Cloudflare tidak
 *    pernah memegangnya; bot hanya mengirim NIAT permintaan (metode, jalur, parameter).
 *  - Tiap permintaan wajib ditandatangani HMAC-SHA256 dengan PROKSI_KUNCI (rahasia bersama bot & server),
 *    memuat waktu (maks selisih 30 detik) dan nonce sekali-pakai -> tidak bisa dipalsukan / diulang.
 *  - Hanya jalur SPOT yang dibutuhkan bot yang diizinkan (daftar JALUR di bawah). Tidak ada jalur tarik dana,
 *    transfer, margin, atau futures — dan kuncinya pun dibuat tanpa izin itu.
 *  - Tanpa pustaka luar (Node 18+). Dijalankan systemd, di belakang Caddy (HTTPS otomatis).
 *
 * PENGATURAN (variabel lingkungan)
 *   BINANCE_KEY, BINANCE_SECRET  kunci ASLI: Enable Reading + Enable Spot & Margin & Stock Trading, IP = VPS ini
 *   PROKSI_KUNCI                 rahasia acak panjang, SAMA dengan PROXY_KUNCI di Cloudflare (amonk-bot)
 *   PORT (8080), HOST (127.0.0.1), BINANCE_BASE (opsional, untuk uji)
 *
 * JALUR
 *   GET  /cek       tanpa tanda tangan: Binance terjangkau dari server ini? (tidak memakai kunci)
 *   POST /panggil   {m, p, q, t, n} + header X-Tanda = hex(HMAC(PROKSI_KUNCI, isi mentah))
 */
const http = require("http"), crypto = require("crypto");

const JALUR = {                                   // metode -> jalur yang boleh diteruskan
  GET: ["/api/v3/account", "/api/v3/openOrders", "/api/v3/order", "/api/v3/orderList", "/api/v3/myTrades", "/sapi/v1/account/apiRestrictions"],
  POST: ["/api/v3/order", "/api/v3/orderList/oco"],
  DELETE: ["/api/v3/order", "/api/v3/orderList"],
};
const HOSTS = process.env.BINANCE_BASE ? [process.env.BINANCE_BASE]
  : ["https://api.binance.com", "https://api-gcp.binance.com", "https://api1.binance.com", "https://api2.binance.com", "https://api3.binance.com"];
const JENDELA = 30e3, nonceTerpakai = new Map();
let hostOk = null;

async function cariHost() {
  if (hostOk) return hostOk;
  for (const h of HOSTS) { try { const r = await fetch(h + "/api/v3/time"); if (r.ok) { hostOk = h; return h; } } catch (e) {} }
  throw new Error("Binance tidak terjangkau dari server ini (lokasi diblokir? pakai VPS di luar AS)");
}
const samaAman = (a, b) => { a = Buffer.from(String(a || "")); b = Buffer.from(String(b || "")); return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b); };
const kirim = (res, status, obj) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };

async function teruskan(m, p, q) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(q || {})) if (v !== undefined && v !== null && k !== "signature" && k !== "timestamp") qs.set(k, String(v));
  qs.set("recvWindow", "10000"); qs.set("timestamp", String(Date.now()));
  qs.set("signature", crypto.createHmac("sha256", process.env.BINANCE_SECRET).update(qs.toString()).digest("hex"));
  const r = await fetch(`${await cariHost()}${p}?${qs}`, { method: m, headers: { "X-MBX-APIKEY": process.env.BINANCE_KEY } });
  const teks = await r.text(); let isi; try { isi = JSON.parse(teks); } catch (e) { isi = { msg: teks.slice(0, 200) }; }
  return { status: r.status, isi };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/cek") {
      let binance = "gagal"; try { await cariHost(); binance = "ok " + hostOk; } catch (e) { binance = e.message; }
      return kirim(res, 200, { proksi: "ok", binance, kunciTerisi: !!(process.env.BINANCE_KEY && process.env.BINANCE_SECRET), rahasiaTerisi: !!process.env.PROKSI_KUNCI });
    }
    if (!(req.method === "POST" && req.url === "/panggil")) return kirim(res, 404, { msg: "jalur tidak dikenal" });
    let mentah = ""; for await (const c of req) { mentah += c; if (mentah.length > 20000) return kirim(res, 413, { msg: "terlalu besar" }); }
    const tanda = crypto.createHmac("sha256", process.env.PROKSI_KUNCI || "").update(mentah).digest("hex");
    if (!process.env.PROKSI_KUNCI || !samaAman(tanda, req.headers["x-tanda"])) return kirim(res, 401, { msg: "tanda tangan salah" });
    const b = JSON.parse(mentah);
    if (!(Math.abs(Date.now() - +b.t) < JENDELA)) return kirim(res, 401, { msg: "waktu permintaan di luar jendela 30 detik" });
    const skr = Date.now(); for (const [k, t] of nonceTerpakai) if (skr - t > 2 * JENDELA) nonceTerpakai.delete(k);
    if (!b.n || nonceTerpakai.has(b.n)) return kirim(res, 401, { msg: "permintaan ulang ditolak" });
    nonceTerpakai.set(b.n, skr);
    const m = String(b.m || "").toUpperCase();
    if (!(JALUR[m] || []).includes(b.p)) return kirim(res, 403, { msg: `jalur tidak diizinkan: ${m} ${b.p}` });
    const hasil = await teruskan(m, b.p, b.q);
    console.log(new Date().toISOString(), m, b.p, (b.q && b.q.symbol) || "", hasil.status);
    return kirim(res, 200, hasil);
  } catch (e) { return kirim(res, 500, { msg: String(e.message || e) }); }
});
server.listen(+(process.env.PORT || 8080), process.env.HOST || "127.0.0.1", () =>
  console.log(`proksi AMONK siap di ${process.env.HOST || "127.0.0.1"}:${process.env.PORT || 8080}`));
