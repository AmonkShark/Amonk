/**
 * NOTIFIKASI TELEGRAM — pola 4H baru di watchlist AMONK.
 * Dijalankan GitHub Actions tiap 4 jam (.github/workflows/notif.yml) di repo AmonkShark/Amonk,
 * jadi tidak butuh laptop maupun Claude. Aturan pola = pola_dc_peristiwa.cjs (sama dengan chart
 * dan aplikasi); level & keluar = aturan aplikasi (50% TP1, SL sisa -> entry, 50% TP2).
 *
 * User 2026-09-22: "ya lakukan" (notifikasi pola baru + rekam jejak koin×pola sebagai INFO).
 * Rekam jejak TIDAK diberi label prioritas: uji 2026-09-22 (research/uji_rekam_jejak_koin_pola.cjs)
 * membuktikan rekam jejak koin×pola tidak meramalkan trade berikutnya.
 *
 * Rahasia (GitHub -> Settings -> Secrets and variables -> Actions), diisi USER sendiri:
 *   TELEGRAM_TOKEN  token bot dari @BotFather
 *   TELEGRAM_CHAT   chat id. Kalau belum ada, skrip mengirim chat id ke obrolan bot itu
 *                   sendiri (tidak ke log publik) supaya user bisa menyimpannya.
 * Tanpa TELEGRAM_TOKEN / dengan DRY=1: hanya mencetak pesan (uji kering).
 *
 * Status "sudah dikirim" disimpan di notif/terkirim.json (di-commit balik oleh workflow),
 * jadi jalan yang terlambat/diulang tidak mengirim dobel.
 */
const fs = require("fs"), path = require("path");
const { peristiwa } = require("./pola_dc_peristiwa.cjs");

const U = require("./universe_gabungan.json");
const KOIN = (U.koin || U).map(s => String(s).toUpperCase());
const SEMBUNYI = new Set(["DB", "RC", "BF"]);          // sama dengan bawaan chart & aplikasi
const MODAL = 1000, BIAYA = 0.002, MAKS = 120;
const JENDELA_BAR = +(process.env.JENDELA_BAR || 2);    // pola valid di N lilin 4H tutup terakhir (2 = aman kalau jadwal GitHub telat)
const TOKEN = process.env.TELEGRAM_TOKEN || "", CHAT = process.env.TELEGRAM_CHAT || "";
const DRY = process.env.DRY === "1" || !TOKEN;
const F_STATUS = path.join(__dirname, "terkirim.json");
const HOSTS = ["https://data-api.binance.vision", "https://api.binance.com", "https://api-gcp.binance.com"];

async function getJ(p) {
  for (const h of HOSTS) {
    try { const r = await fetch(h + p); if (r.ok) return await r.json(); if (r.status === 400) return null; } catch (e) {}
  }
  return null;
}
const atrArr = (h, l, c, n = 14) => {
  const o = new Array(c.length).fill(null); if (c.length <= n) return o;
  const tr = i => Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  let a = 0; for (let i = 1; i <= n; i++) a += tr(i); a /= n; o[n] = a;
  for (let i = n + 1; i < c.length; i++) { a = (a * (n - 1) + tr(i)) / n; o[i] = a; }
  return o;
};
function level(d, e) {
  const entry = d.c[e.i], sl = e.batal, tp2 = e.level + e.tinggi;
  if (!(entry > sl) || !(tp2 > entry)) return null;
  let tp1 = entry + 0.75 * (entry - sl); if (tp1 >= tp2) tp1 = entry + 0.5 * (tp2 - entry);
  return { entry, sl, tp1, tp2 };
}
// hasil trade dengan aturan aplikasi; null kalau belum tutup
function hasilA(d, i, L) {
  const n = d.c.length, akhir = Math.min(n - 1, i + MAKS);
  let sisa = 1, real = 0, fase = 0;
  const tutup = (w, px) => { real += w * MODAL * (px / L.entry - 1); sisa -= w; };
  for (let k = i + 1; k <= akhir && sisa > 1e-9; k++) {
    const o = d.o[k], h = d.h[k], l = d.l[k];
    if (fase === 0) {
      if (o <= L.sl) { tutup(sisa, o); break; } if (l <= L.sl) { tutup(sisa, L.sl); break; }
      if (h >= L.tp1) { fase = 1; tutup(0.5, L.tp1); if (h >= L.tp2) { tutup(sisa, L.tp2); break; } }
    } else {
      if (o <= L.entry) { tutup(sisa, o); break; } if (l <= L.entry) { tutup(sisa, L.entry); break; }
      if (h >= L.tp2) { tutup(sisa, L.tp2); break; }
    }
  }
  if (sisa > 1e-9) { if (akhir === i + MAKS) tutup(sisa, d.c[akhir]); else return null; }
  return real - MODAL * BIAYA;
}
const fx = p => { const a = Math.abs(p); const dp = a >= 1000 ? 1 : a >= 10 ? 3 : a >= 1 ? 4 : a >= 0.01 ? 5 : a >= 0.0001 ? 7 : 9; return p.toFixed(dp); };
const pc = (x, e) => ((x / e - 1) * 100 >= 0 ? "+" : "") + ((x / e - 1) * 100).toFixed(1) + "%";
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function kirim(teks, chat) {
  if (DRY) { console.log("---- (uji kering) ----\n" + teks.replace(/<[^>]+>/g, "") + "\n"); return true; }
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat || CHAT, text: teks, parse_mode: "HTML", disable_web_page_preview: true }) });
  if (!r.ok) console.log("Telegram menolak: HTTP " + r.status);
  return r.ok;
}

(async () => {
  // Langkah pasang: belum ada chat id -> cari dari pesan terakhir ke bot, kirim ke obrolan itu sendiri.
  if (!DRY && !CHAT) {
    const u = await (await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates`)).json().catch(() => ({}));
    const m = (u.result || []).map(x => x.message || x.channel_post).filter(Boolean).pop();
    if (!m) { console.log("TELEGRAM_CHAT belum diisi dan bot belum menerima pesan. Kirim /start ke bot dulu, lalu jalankan ulang."); return; }
    await kirim(`✅ Bot AMONK tersambung.\nChat ID kamu: <code>${m.chat.id}</code>\nSimpan angka ini sebagai secret <b>TELEGRAM_CHAT</b> di GitHub, lalu jalankan workflow sekali lagi.`, m.chat.id);
    console.log("Chat id dikirim ke obrolan bot (tidak dicetak di log).");
    return;
  }

  let status = {}; try { status = JSON.parse(fs.readFileSync(F_STATUS, "utf8")); } catch (e) {}
  const sekarang = Date.now();
  let baru = 0, dicek = 0;
  for (const k of KOIN) {
    const j = await getJ(`/api/v3/klines?symbol=${k}USDT&interval=4h&limit=600`);
    if (!Array.isArray(j) || j.length < 250) continue;
    const b = j.filter(x => +x[6] < sekarang);                           // buang lilin berjalan
    if (!b.length || sekarang - +b[b.length - 1][6] > 12 * 3600e3) continue;   // koin basi/delisting
    dicek++;
    const d = { t: b.map(x => +x[0]), o: b.map(x => +x[1]), h: b.map(x => +x[2]), l: b.map(x => +x[3]), c: b.map(x => +x[4]), v: b.map(x => +x[5]) };
    let ev = []; try { ev = peristiwa(d, atrArr(d.h, d.l, d.c)) || []; } catch (e) { continue; }
    ev = ev.filter(e => !SEMBUNYI.has(e.kode));
    const n = d.c.length;
    for (const e of ev.filter(e => e.i >= n - JENDELA_BAR)) {
      const kunci = `${k}|${e.nama}|${d.t[e.i]}`;
      if (status[kunci]) continue;
      const L = level(d, e); if (!L) continue;
      // rekam jejak koin+pola yang sama di jendela 600 lilin (hanya trade yang sudah tutup) — INFO saja
      const lalu = ev.filter(x => x.nama === e.nama && x.i < e.i).map(x => { const LL = level(d, x); return LL ? hasilA(d, x.i, LL) : null; }).filter(x => x != null);
      const rj = lalu.length ? `${lalu.length} trade, ${lalu.filter(x => x > 0).length} untung, total ${(lalu.reduce((a, x) => a + x, 0) >= 0 ? "+" : "")}${lalu.reduce((a, x) => a + x, 0).toFixed(0)} USDT` : "belum ada";
      const vol = d.v.slice(-6).reduce((a, x, q) => a + x * d.c[n - 6 + q], 0);
      const waktu = new Date(d.t[e.i] + 4 * 3600e3).toISOString().slice(5, 16).replace("-", "/").replace("T", " ");
      const teks =
        `🔔 <b>POLA 4H BARU — ${esc(k)}</b>\n` +
        `${esc(e.nama)} · valid lilin tutup ${waktu} UTC\n\n` +
        `Entry  <b>${fx(L.entry)}</b>\n` +
        `SL     ${fx(L.sl)}  (${pc(L.sl, L.entry)})\n` +
        `TP1   ${fx(L.tp1)}  (${pc(L.tp1, L.entry)}) → ambil 50%, SL sisa ke entry\n` +
        `TP2   ${fx(L.tp2)}  (${pc(L.tp2, L.entry)})\n` +
        `Likuiditas 24j ≈ $${(vol / 1e6).toFixed(1)}jt${vol < 1e6 ? " ⚠️ tipis" : ""}\n\n` +
        `Rekam jejak ${esc(k)} + ${esc(e.nama)} (~100 hari): ${rj}.\n` +
        `<i>Info saja — rekam jejak koin×pola terbukti TIDAK meramalkan hasil berikutnya, dan pola 4H dalam uji panjang impas. Bukan aba-aba beli.</i>\n\n` +
        `<a href="https://www.tradingview.com/chart/?symbol=BINANCE:${esc(k)}USDT&interval=240">Chart 4H</a> · <a href="https://amonkshark.github.io/Amonk/">Aplikasi</a>`;
      if (await kirim(teks)) { status[kunci] = sekarang; baru++; }
    }
  }
  // bersihkan status lebih dari 30 hari
  for (const [kk, t] of Object.entries(status)) if (sekarang - t > 30 * 864e5) delete status[kk];
  if (!DRY) fs.writeFileSync(F_STATUS, JSON.stringify(status, null, 0));
  console.log(`selesai: ${dicek} koin dicek, ${baru} notifikasi ${DRY ? "(uji kering, tidak dikirim)" : "terkirim"}`);
})();
