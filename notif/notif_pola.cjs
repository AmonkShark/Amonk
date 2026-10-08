/**
 * NOTIFIKASI TELEGRAM — pola 4H di watchlist AMONK. Dijalankan GitHub Actions
 * (.github/workflows/notif.yml, sumber notif/notif.yml) tanpa laptop maupun Claude.
 * Aturan pola = pola_dc_peristiwa.cjs (sama dengan chart & aplikasi); level & keluar =
 * aturan aplikasi (50% TP1, SL sisa -> entry, 50% TP2, tanpa batas waktu).
 *
 * Isi (permintaan user 2026-09-22):
 *   1. POLA BARU — kartu "AMONK SINYAL". Tujuan PRIBADI (chat id angka positif) juga dapat
 *      UKURAN POSISI untuk risiko RISIKO_PCT% dari saldo Binance (dibaca lewat perantara
 *      Cloudflare). Channel/grup TIDAK mendapat baris itu supaya saldo tidak tersebar.
 *   2. EXIT — pesan saat TP1 kena (ambil 50%, pindahkan SL ke entry), TP2 kena, SL kena,
 *      atau sisa keluar di entry. Dinilai di lilin 4H tutup, jadi bisa telat s.d. ~4 jam:
 *      pasang TP/SL di Binance sendiri, pesan ini konfirmasi & pengingat pindah SL.
 *   5. REKAP MINGGUAN (MODE rekap, Minggu 20:00 WIB) dari notif/maju.json — catatan maju
 *      semua pola sejak 22-09-2026 (tidak hilang walau lewat jendela 600 lilin).
 * Rekam jejak TIDAK diberi label prioritas (research/uji_rekam_jejak_koin_pola.cjs: tidak meramalkan).
 *
 * Rahasia GitHub Actions (diisi USER): TELEGRAM_TOKEN, TELEGRAM_CHAT ("id,@channel"),
 *   AKUN_URL (alamat Worker Binance), SANDI_APP (sandi Worker); opsional MODAL_USDT (cadangan
 *   bila Worker gagal), RISIKO_PCT (bawaan 0.5).
 * DRY=1 atau tanpa token: hanya mencetak (uji kering). UJI=true: 1 pesan contoh. REKAP=true: rekap sekarang.
 */
const fs = require("fs"), path = require("path");
const { peristiwa, elliott } = require("./pola_dc_peristiwa.cjs");

const U = require("./universe_gabungan.json");
const KOIN = (U.koin || U).map(s => String(s).toUpperCase());
const SEMBUNYI = new Set(["DB", "RC", "BF", "CH", "IHS", "PEN"]);          // sama dengan bawaan chart & aplikasi
// 2026-10-06 (user: "sinkronkan ... github, telegram dan terminal"): Telegram hanya mengirim pola yang dipakai trading (TB/FW/EW, sama dengan kolom
// Terminal). ST & AT tetap DICATAT di maju.json (buku) tapi tidak dikirim/dihitung di rekap. + sinyal Lab L030 & L027 (notif/sinyal_lab.cjs).
const TG_TAMPIL = new Set(["TB", "FW", "EW"]);
// 2026-10-07 (user: "yang muncul di telegram itu semuanya hanya sinyal yang di pakai di bot"): FW hanya bila garis MACD 4H di lilin VALID > 0
// (= worker macdGaris4h, FW_MACD_ATAS0), kartu & scan 1D dimatikan, POTENSI NAIK dibuang. ST/AT tetap dicatat di maju.json (buku), tidak dikirim.
function macdDi(c, i) {                         // EMA12 − EMA26 dari <= 299 close tutup s/d lilin i, EMA dibenih SMA — sama dengan worker
  const a = c.slice(Math.max(0, i - 298), i + 1); if (a.length < 120) return null;
  const ema = n => { let e = a.slice(0, n).reduce((x, y) => x + y, 0) / n; const k = 2 / (n + 1); for (let q = n; q < a.length; q++) e = a[q] * k + e * (1 - k); return e; };
  return ema(12) - ema(26);
}
const dipakaiBot = (kode, macd) => TG_TAMPIL.has(kode) && (kode !== "FW" || macd > 0);
const LAB = require("./sinyal_lab.cjs");
const NOMINAL = 1000, BIAYA = 0.002;
const JENDELA_BAR = +(process.env.JENDELA_BAR || 2);    // pola baru = valid di N lilin 4H tutup terakhir
const TOKEN = process.env.TELEGRAM_TOKEN || "", CHAT = process.env.TELEGRAM_CHAT || "";
const DRY = process.env.DRY === "1" || !TOKEN;
const UJI = process.env.UJI === "true";
const REKAP = process.env.REKAP === "true" || process.env.JADWAL === "0 13 * * 0";
const RISIKO_PCT = +(process.env.RISIKO_PCT || 0.5);
// Cara ukuran (2026-09-22, user "setiap aku trade selalu membagi modal menjadi 3"):
// "bagi" (bawaan) = nilai posisi saldo ÷ BAGI_MODAL; "risiko" = rugi bila SL = RISIKO_PCT% saldo.
const CARA_UKURAN = process.env.CARA_UKURAN === "risiko" ? "risiko" : "bagi";
const BAGI_MODAL = Math.max(1, Math.round(+(process.env.BAGI_MODAL || 3)) || 3);
const AKUN_URL = (process.env.AKUN_URL || "").replace(/\/+$/, ""), SANDI = process.env.SANDI_APP || "";
const MODAL_CADANGAN = +(process.env.MODAL_USDT || 0);
const F_STATUS = path.join(__dirname, "terkirim.json"), F_MAJU = path.join(__dirname, "maju.json");
const F_AUDIT = path.join(__dirname, "audit.json");   // saran #4: sekali kirim per ambang tercapai
// Uji kering saja: MAJU_MULAI_UJI (ms) memundurkan awal pemantauan, AUDIT_PAKSA=1 melewati ambang n/bulan.
const MAJU_MULAI = DRY && +process.env.MAJU_MULAI_UJI ? +process.env.MAJU_MULAI_UJI : Date.UTC(2026, 8, 22, 0, 0);   // sama dengan mode "Maju" di aplikasi
const AUDIT_PAKSA = DRY && process.env.AUDIT_PAKSA === "1";
const HOSTS = ["https://data-api.binance.vision", "https://api.binance.com", "https://api-gcp.binance.com"];
const STABIL = new Set(["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "DAI"]);

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
// TP per pola (pilihan user 2026-09-24; uji 0 lolos ambang): [TP1 dalam R, TP2 dalam R atau null = target pola]
const TP_A = { FW: [1.5, null], ST: [1.5, 2], AT: [1, null], TB: [1.5, 3], EW: [0.5, null] };
// TRAILING sesudah TP1 (user 2026-09-24): FW, TB, EW trailing 15% dari puncak (stop mulai di entry), tanpa TP2; ST & AT tetap TP2
const TRAIL_K = new Set(["FW", "TB", "EW"]), TRAIL_P = 0.15, TB_MURNI_P = 0.25;   // TB murni 25% (2026-09-28, keputusan user)
function tpAturan(kode, entry, sl, tpBuku) {
  const [a, t] = TP_A[kode] || [0.75, null], tp2 = t ? entry + t * (entry - sl) : tpBuku;
  let tp1 = entry + a * (entry - sl); if (tp1 >= tp2) tp1 = entry + 0.5 * (tp2 - entry);
  return { tp1, tp2 };
}
function level(d, e) {
  // Elliott (EW) masuk lewat LIMIT: entry = harga limit (e.entry), bukan close bar isian.
  const entry = e.entry != null ? e.entry : d.c[e.i], sl = e.batal, tpB = e.level + e.tinggi;
  if (!(entry > sl) || !(tpB > entry)) return null;
  const { tp1, tp2 } = tpAturan(e.kode, entry, sl, tpB);
  return { entry, sl, tp1, tp2, trailP: e.kode === "TB" ? TB_MURNI_P : TRAIL_K.has(e.kode) ? TRAIL_P : 0, murni: e.kode === "TB" };
}
// Simulasi aturan aplikasi sampai lilin terakhir; sama dengan simTrade() di aplikasi.
function simTahap(d, i, L) {
  const n = d.c.length;
  if (L.murni) {   // TB MURNI (2026-09-28): 100% posisi, trailing L.trailP dari puncak sejak masuk, lantai SL awal, tanpa TP1/BE
    let pk = d.h[i], st = "jalan", keluarT = null, keluarPx = null, real = 0, sisa = 1;
    for (let k = i + 1; k < n; k++) { const stop = Math.max(L.sl, pk * (1 - L.trailP)); if (d.l[k] <= stop) { const px = Math.min(d.o[k], stop); real = NOMINAL * (px / L.entry - 1); sisa = 0; keluarPx = px; st = stop > L.sl * 1.0005 ? "TP2" : "SL"; keluarT = d.t[k]; break; } if (d.h[k] > pk) pk = d.h[k]; }
    return { st, kenaTp1: false, tTp1: null, keluarT, sisa, real, trail: true, keluarPx, usdt: sisa === 0 ? real - NOMINAL * BIAYA : null };
  }
  let st = "jalan", kenaTp1 = false, sisa = 1, real = 0, tTp1 = null, keluarT = null;
  const tutup = (w, px) => { real += w * NOMINAL * (px / L.entry - 1); sisa -= w; };
  let puncak = 0, keluarPx = null; const trail = L.trailP > 0;
  for (let k = i + 1; k < n && st === "jalan"; k++) {
    if (!kenaTp1) {
      if (d.l[k] <= L.sl) { tutup(1, L.sl); st = "SL"; keluarT = d.t[k]; }
      else if (d.h[k] >= L.tp1) {
        tutup(0.5, L.tp1); kenaTp1 = true; tTp1 = d.t[k]; puncak = Math.max(L.tp1, d.h[k]);
        if (!trail && d.h[k] >= L.tp2) { tutup(sisa, L.tp2); st = "TP2"; keluarT = d.t[k]; }
      }
    } else if (trail) {
      const stop = Math.max(L.entry, puncak * (1 - L.trailP));
      if (d.l[k] <= stop) { tutup(sisa, stop); keluarPx = stop; st = stop > L.entry * 1.0005 ? "TP2" : "BE"; keluarT = d.t[k]; }
      else if (d.h[k] > puncak) puncak = d.h[k];
    } else if (d.l[k] <= L.entry) { tutup(sisa, L.entry); st = "BE"; keluarT = d.t[k]; }
    else if (d.h[k] >= L.tp2) { tutup(sisa, L.tp2); st = "TP2"; keluarT = d.t[k]; }
  }
  if (Math.abs(sisa) < 1e-9) sisa = 0;
  return { st, kenaTp1, tTp1, keluarT, sisa, real, trail, keluarPx, usdt: sisa === 0 ? real - NOMINAL * BIAYA : null };
}
const fx = p => { const a = Math.abs(p); const dp = a >= 1000 ? 1 : a >= 10 ? 3 : a >= 1 ? 4 : a >= 0.01 ? 5 : a >= 0.0001 ? 7 : 9; return p.toFixed(dp); };
const pc = (x, e) => ((x / e - 1) * 100 >= 0 ? "+" : "") + ((x / e - 1) * 100).toFixed(1) + "%";
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const angka = (x, dp = 0) => x.toLocaleString("en-US", { maximumFractionDigits: dp });
// PERINGKAT POLA (2026-09-26, permintaan user): SAMA dengan aplikasi — dari hasil simulasi 100 hari (600 lilin 4H) semua koin, rata USDT/trade tutup, n>=10 dulu.
// Dihitung tiap run dan disimpan notif/peringkat.json (dipakai run berikutnya, jadi pesan memakai peringkat run sebelumnya, maks 4 jam basi).
// Bukan edge (peringkat berbalik antar periode); hanya urutan saat slot terbatas. Cadangan bila berkas belum ada: urutan aplikasi 26-09.
const F_PERINGKAT = path.join(__dirname, "peringkat.json");
let PRK = {}; try { PRK = JSON.parse(fs.readFileSync(F_PERINGKAT, "utf8")).urut || {}; } catch (e) {}
const PRK_CADANGAN = { TB: 1, EW: 2, FW: 3, ST: 4, AT: 5 };
// 2026-10-08 (user: "samakan peringkat di app dan telegram"): #1 L027 · #2 L030 · #3 TB · #4 FW · #5 EW (uji vs masuk acak koin+bulan; sama dgn app, Pine & worker).
// (dulu 2026-10-07: #1 TB · #2 L027 · #3 L030 · #4 FW · #5 EW)
// peringkat.json dinamis tetap dihitung & disimpan (dipakai worker untuk urutan antrean), hanya tidak dipakai untuk label.
const PRK_TETAP = { L027: 1, L030: 2, TB: 3, FW: 4, EW: 5, ST: 6, AT: 7 };
const PERINGKAT = k => "#" + (PRK_TETAP[k] || (PRK[k] && PRK[k].no) || PRK_CADANGAN[k] || 6);
const PRK_TALLY = {};   // kode -> {n, tot, m} diisi selama run
function prkCatat(kode, s) { if (s.usdt == null) return; const x = PRK_TALLY[kode] = PRK_TALLY[kode] || { n: 0, tot: 0, m: 0 }; x.n++; x.tot += s.usdt; if (s.usdt > 0) x.m++; }
function prkSimpan() {
  const urutA = Object.entries(PRK_TALLY).map(([k, x]) => ({ k, n: x.n, rata: x.tot / x.n, wr: x.m / x.n * 100 })).sort((a, b) => (b.n >= 10) - (a.n >= 10) || b.rata - a.rata);
  if (!urutA.length) return; const urut = {}; urutA.forEach((x, i) => urut[x.k] = { no: i + 1, n: x.n, rata: +x.rata.toFixed(2), wr: +x.wr.toFixed(1) });
  if (!DRY) fs.writeFileSync(F_PERINGKAT, JSON.stringify({ t: Date.now(), hari: 100, urut }));
  console.log("peringkat pola: " + urutA.map((x, i) => "#" + (i + 1) + " " + x.k + " " + (x.rata >= 0 ? "+" : "") + x.rata.toFixed(1) + " n" + x.n).join(" · "));
}
const wib = t => new Date(t + 7 * 3600e3).toISOString().slice(5, 16).replace(/(\d\d)-(\d\d)T/, "$2/$1 ") + " WIB";
const tautan = (k, tf = "4H") => `<a href="https://www.tradingview.com/chart/?symbol=BINANCE:${esc(k)}USDT&interval=${tf === "1D" ? "D" : "240"}">Chart ${tf}</a>`;   // link Aplikasi dibuang 2026-09-23 (permintaan user)

// ---------- 1. ukuran posisi berdasar risiko (hanya untuk tujuan pribadi) ----------
async function ambilModal() {
  if (AKUN_URL && SANDI) {
    try {
      const r = await fetch(AKUN_URL + "/akun", { headers: { "X-Sandi": SANDI } });
      const j = await r.json();
      if (r.ok && Array.isArray(j.saldo)) {
        const harga = {}; const t = await getJ("/api/v3/ticker/price");
        if (Array.isArray(t)) for (const x of t) if (x.symbol.endsWith("USDT")) harga[x.symbol.slice(0, -4)] = +x.price;
        let total = 0;
        for (const b of j.saldo) { const px = STABIL.has(b.aset) ? 1 : harga[b.aset]; if (px) total += (b.bebas + b.terkunci) * px; }
        if (total > 0) return { modal: total, sumber: "saldo Binance" };
      } else console.log("Worker akun menolak: HTTP " + r.status);
    } catch (e) { console.log("Worker akun gagal dihubungi"); }
  }
  return MODAL_CADANGAN > 0 ? { modal: MODAL_CADANGAN, sumber: "MODAL_USDT" } : null;
}
// SIMULASI 1000 USDT (2026-10-08, user: channel tanpa uang bot — "ganti semuanya dengan modal 1000 usdt"): baris ukuran untuk tujuan PUBLIK
function simTeks(L) {
  if (!(L && L.entry > L.sl && L.sl > 0)) return "";
  const rugi = 1000 * (L.entry - L.sl) / L.entry + 2, tp1 = L.tp1 > L.entry && !L.murni ? 500 * (L.tp1 / L.entry - 1) : null;
  return `💵 Simulasi 1000 USDT: rugi bila SL <b>−${angka(rugi, 2)} USDT</b>${tp1 != null ? ` · untung di TP1 (50%) <b>+${angka(tp1, 2)} USDT</b>` : ""}\n`;
}
function ukuranTeks(L, M) {
  if (!M) return `📏 Ukuran: isi secret AKUN_URL + SANDI_APP (atau MODAL_USDT) untuk ukuran posisi otomatis\n`;
  let qty, nilai, batas = false;
  if (CARA_UKURAN === "bagi") { nilai = M.modal / BAGI_MODAL; qty = nilai / L.entry; }
  else {
    qty = M.modal * RISIKO_PCT / 100 / (L.entry - L.sl); nilai = qty * L.entry;
    if (nilai > M.modal) { qty = M.modal / L.entry; nilai = M.modal; batas = true; }
  }
  const rugi = qty * (L.entry - L.sl);
  return `📏 Ukuran (${CARA_UKURAN === "bagi" ? `1/${BAGI_MODAL} saldo` : `risiko ${RISIKO_PCT}%`}): <b>${angka(qty, qty < 10 ? 4 : 0)}</b> koin ≈ <b>${angka(nilai)} USDT</b>\n` +
    `     rugi bila SL ≈ ${angka(rugi, 2)} USDT (${(rugi / M.modal * 100).toFixed(1)}% saldo) · saldo ${angka(M.modal)} USDT${batas ? " · dibatasi saldo" : ""}\n`;
}

// ---------- pesan ----------
function pesanBaru(k, e, L, d, vol, uji, ukuran, tf = "4H") {
  return (uji ? "🧪 <b>PESAN UJI</b> — contoh, bukan pola baru\n\n" : "") +
    `<b>AMONK SINYAL</b>\n` +
    `◻️◻️◻️◻️◻️\n` +
    `📊 EXCHANGE: BINANCE\n` +
    `💰 Coin: <b>${esc(k)}/USDT</b>\n` +
    `⏱ Timeframe: <b>${tf}</b>\n` +
    `📐 Pola: <b>${PERINGKAT(e.kode)} ${esc(e.nama)}</b>\n` +
    (e.kode === "EW" ? `✅ Limit terisi: <b>${fx(L.entry)}</b>  (Elliott masuk lewat LIMIT beli, bukan tembus)\n` : `✅ Entry: <b>${fx(L.entry)}</b>\n`) +
    `🎯 TP1: ${fx(L.tp1)}  (${pc(L.tp1, L.entry)})  ambil 50%, SL naik ke entry\n` +
    (L.trailP ? `🔁 Sisa 50%: trailing ${Math.round(L.trailP * 100)}% dari puncak (stop mulai di entry, naik mengikuti harga) — tanpa TP2\n` : `🎯 TP2: ${fx(L.tp2)}  (${pc(L.tp2, L.entry)})\n`) +
    `‼️ SL: ${fx(L.sl)}  (${pc(L.sl, L.entry)})\n` +
    (ukuran || "") +
    `🕒 valid ${wib(d.t[e.i] + (tf === "1D" ? 864e5 : 4 * 3600e3))}${vol != null && vol < 1e6 ? "\n⚠️ likuiditas tipis (< $1jt/hari)" : ""}\n` +
    (tf === "1D" ? `ℹ️ Pola 1D: di uji proyek tidak lebih baik dari entry acak, SL lebar — hitung ukuran dari rugi-bila-SL. Update TP/SL 1D tidak dikirim; pantau di scan harian.\n` : "") +
    `\n` + tautan(k, tf);
}
// ---------- 1a. SETUP ELLIOTT BARU (2026-09-23, permintaan user): limit Elliott 4H yang BARU LAHIR — sekali per setup.
// Belum ada posisi: pasang limit beli sendiri bila mau. Level sama dengan chart (ELLIOTT ✓) & bot; SL perkiraan
// dari ATR lilin sekarang (dihitung ulang saat terisi).
function pesanSetupEw(k, S, d, vol, ukuran) {
  const n = d.c.length, px = d.c[n - 1], L = { entry: S.level, sl: S.batal, tp2: S.level + S.tinggi, trailP: TRAIL_P };
  L.tp1 = L.entry + 0.5 * (L.entry - L.sl); if (L.tp1 >= L.tp2) L.tp1 = L.entry + 0.5 * (L.tp2 - L.entry);
  const habis = d.t[S.lahirB] + 61 * 4 * 3600e3;
  return `<b>AMONK SINYAL · SETUP</b>\n` +
    `◻️◻️◻️◻️◻️\n` +
    `📊 EXCHANGE: BINANCE\n` +
    `💰 Coin: <b>${esc(k)}/USDT</b>\n` +
    `⏱ Timeframe: <b>4H</b>\n` +
    `📐 Pola: <b>${PERINGKAT("EW")} Elliott Wave</b> — setup baru (ayunan gel.3 ${S.ayun.toFixed(0)}%)\n` +
    `⏳ Limit beli: <b>${fx(L.entry)}</b>  (${pc(L.entry, px)} dari harga ${fx(px)})\n` +
    `🎯 TP1: ${fx(L.tp1)}  (${pc(L.tp1, L.entry)})  ambil 50%, SL naik ke entry\n` +
    (L.trailP ? `🔁 Sisa 50%: trailing ${Math.round(L.trailP * 100)}% dari puncak (stop mulai di entry, naik mengikuti harga) — tanpa TP2\n` : `🎯 TP2: ${fx(L.tp2)}  (${pc(L.tp2, L.entry)})\n`) +
    `‼️ SL: ${fx(L.sl)}  (${pc(L.sl, L.entry)})  perkiraan, dihitung ulang saat terisi\n` +
    (ukuran || "") +
    `⌛ Batal bila tidak tersentuh s/d ${wib(habis)} (60 lilin 4H) atau siklus patah\n` +
    `🕒 setup ${wib(d.t[S.lahirB] + 4 * 3600e3)}${vol != null && vol < 1e6 ? "\n⚠️ likuiditas tipis (< $1jt/hari)" : ""}\n` +
    `<i>Belum sinyal masuk: entry hanya bila harga TURUN menyentuh limit. Peringkat pola saat ini ${PERINGKAT("EW")} (dari hasil 100 hari, bukan edge).</i>\n` +
    `\n` + tautan(k, "4H");
}
// ---------- 1b. POLA 1D BARU (2026-09-22, disetujui user): kartu yang sama, Timeframe 1D ----------
// Lilin 1D Binance tutup 00:00 UTC; run 00:07 UTC (10:07 Sydney AEST) langsung menangkapnya, run
// cadangan 00:37 / 04:07 / 04:37 menangkapnya kalau yang pertama terlewat. Hanya pola yang valid di
// lilin 1D TUTUP terakhir, dan hanya dalam 3 jam sesudah lilin itu tutup (run 00:07 + cadangan 00:37, toleransi telat GitHub) (supaya tidak ada kartu
// basi berjam-jam). Dedupe di terkirim.json dengan kunci berawalan "1D|", tahap langsung "tutup"
// (update exit 1D TIDAK dikirim). Tidak masuk maju.json: catatan maju hanya untuk 4H.
const TF1D_AKTIF = process.env.TF1D === "true",   // 2026-10-07: bawaan MATI (1D tidak dipakai bot)
      JENDELA_1D_JAM = +(process.env.JENDELA_1D_JAM || 20);   // 2026-10-03: 3 -> 20 jam. Run 00:07/00:37 UTC sering telat/terlewat di GitHub (HEI 26-09, BB 25-09, XRP & PLUME 22/23-09 tidak terkirim); run 4-jaman berikutnya kini menyusulkan kartu 1D. Tanpa ganda: kunci "1D|" di terkirim.json.
async function cek1D(k, status, M, sekarang) {
  const j = await getJ(`/api/v3/klines?symbol=${k}USDT&interval=1d&limit=1000`);
  if (!Array.isArray(j) || j.length < 120) return 0;
  const b = j.filter(x => +x[6] < sekarang);
  if (!b.length) return 0;
  const tutupT = +b[b.length - 1][6] + 1;
  if (sekarang - tutupT > JENDELA_1D_JAM * 3600e3) return 0;
  const d = { t: b.map(x => +x[0]), o: b.map(x => +x[1]), h: b.map(x => +x[2]), l: b.map(x => +x[3]), c: b.map(x => +x[4]), v: b.map(x => +x[5]) };
  const n = d.c.length;
  let ev = []; try { ev = peristiwa(d, atrArr(d.h, d.l, d.c), { elliott: true }) || []; } catch (e) { return 0; }   // + Elliott 1D
  let baru = 0;
  for (const e of ev) {
    if (SEMBUNYI.has(e.kode) || !TG_TAMPIL.has(e.kode) || e.i !== n - 1) continue;
    const L = level(d, e); if (!L || !(L.sl > 0)) continue;
    const kunci = `1D|${k}|${e.nama}|${d.t[e.i]}`;
    if (status[kunci]) continue;
    const vol = +b[n - 1][7];
    if (await kirim(pesanBaru(k, e, L, d, vol, false, null, "1D"), pesanBaru(k, e, L, d, vol, false, ukuranTeks(L, M), "1D"))) {
      status[kunci] = { t: sekarang, tahap: "tutup" }; baru++;
    }
  }
  return baru;
}
// SINYAL LAB (2026-10-06): kartu baru, TP1, tutup. Aturan = notif/sinyal_lab.cjs (salinan aplikasi). BELUM TERBUKTI, bukan sinyal bot.
function pesanLab(k, t, jenis) {
  const kepala = `<b>AMONK SINYAL · ${PERINGKAT(t.kode)} ${esc(t.kode)}${jenis === "BARU" ? "" : " · UPDATE"}</b>\n💰 <b>${esc(k)}/USDT</b> · 4H · ${esc(t.nama)}${t.pola ? " (setup " + esc(t.pola) + ")" : ""}\n`;
  const R = jenis === "TUTUP" ? t.R : null;
  const isi = jenis === "BARU"
    ? `✅ Entry: <b>${fx(t.entry)}</b> (close lilin sinyal)\n🛑 SL: <b>${fx(t.sl)}</b> (${pc(t.sl, t.entry)}) · low 5 lilin − 0,5 ATR\n🎯 TP1: <b>${fx(t.tp1)}</b> (${pc(t.tp1, t.entry)}) · 1,5R, ambil 50%\n${simTeks({ entry: t.entry, sl: t.sl, tp1: t.tp1 })}🔁 Sisa: trailing 15% dari high tertinggi (stop tidak di bawah SL), batas 120 lilin 4H\n🕒 sinyal ${wib(t.masukT + 4 * 3600e3)}\n`
    : jenis === "TP1" ? `🎯 <b>TP1 TERCAPAI</b> di ${fx(t.tp1)} (${pc(t.tp1, t.entry)})\n💵 Simulasi 1000 USDT: <b>+${angka(500 * (t.tp1 / t.entry - 1), 2)} USDT</b> terkunci (50%)\n👉 Ambil 50%; sisa trailing 15% dari high tertinggi (stop kini ${fx(t.stop)})\n`
    : `📕 <b>TUTUP</b>: ${esc(t.sebab)} di ${fx(t.keluarPx)} (${pc(t.keluarPx, t.entry)})\n📊 Hasil: <b>${R >= 0 ? "+" : ""}${R.toFixed(2)} R</b> (sesudah biaya)${t.kenaTp1 ? " · 50% sudah diambil di TP1" : ""}\n💵 Simulasi 1000 USDT: <b>${(u => (u >= 0 ? "+" : "") + angka(u, 2))((t.kenaTp1 ? 500 * (t.tp1 / t.entry - 1) + 500 * (t.keluarPx / t.entry - 1) : 1000 * (t.keluarPx / t.entry - 1)) - 2)} USDT</b>\n`;
  return kepala + isi + `<i>Belum terbukti — dipantau maju.</i>\n\n` + tautan(k, "4H");
}
function pesanExit(k, nama, kode, L, s, jenis, validT) {
  const kepala = `<b>AMONK SINYAL · UPDATE</b>\n💰 <b>${esc(k)}/USDT</b> · 4H · ${PERINGKAT(kode)} ${esc(nama)}\n`;
  const hasil = s.usdt != null ? `\n📊 Hasil trade: <b>${(s.usdt >= 0 ? "+" : "") + (s.usdt / NOMINAL * 100).toFixed(2)}%</b> (${(s.usdt >= 0 ? "+" : "") + s.usdt.toFixed(2)} USDT per 1000, sesudah biaya)` : "";
  const isi = {
    TP1: `🎯 <b>TP1 TERCAPAI</b> di ${fx(L.tp1)} (${pc(L.tp1, L.entry)})\n💵 Simulasi 1000 USDT: <b>+${angka(500 * (L.tp1 / L.entry - 1), 2)} USDT</b> terkunci (50%)\n👉 Ambil 50%, <b>pindahkan SL sisa ke entry ${fx(L.entry)}</b>\n` + (L.trailP ? `🔁 Sisa: trailing ${Math.round(L.trailP * 100)}% dari puncak (stop naik mengikuti harga, tanpa TP2)` : `🎯 Sisa menunggu TP2 ${fx(L.tp2)}`),
    TRAIL: `🔁🏁 <b>TRAILING ${Math.round(L.trailP * 100)}% KENA</b> di ~${s.keluarPx ? fx(s.keluarPx) : "?"} (${s.keluarPx ? pc(s.keluarPx, L.entry) : ""}) — ${L.murni ? "posisi penuh keluar (TB murni, tanpa TP1)" : "sisa 50% keluar"}, trade selesai${L.murni ? "" : "\nTP1 " + fx(L.tp1) + " (50%) · sisa dengan trailing"}`,
    TP2: `🏁 <b>TP2 TERCAPAI</b> di ${fx(L.tp2)} (${pc(L.tp2, L.entry)}) — trade selesai`,
    TP1TP2: `🎯🏁 <b>TP1 & TP2 TERCAPAI</b> — trade selesai\nTP1 ${fx(L.tp1)} · TP2 ${fx(L.tp2)}`,
    BE: `↩️ <b>Sisa 50% keluar di entry</b> ${fx(L.entry)} (impas) — trade selesai`,
    TP1BE: `🎯 TP1 ${fx(L.tp1)} tercapai lalu ↩️ <b>sisa keluar di entry</b> ${fx(L.entry)} — trade selesai`,
    SL: `‼️ <b>SL KENA</b> di ${fx(L.sl)} (${pc(L.sl, L.entry)}) — trade selesai`,
  }[jenis];
  return kepala + isi + hasil + `\n🕒 pola valid ${wib(validT)} · dinilai di lilin 4H tutup\n\n` + tautan(k);
}

// ---------- kirim ----------
// TELEGRAM_CHAT boleh "id,@channel". Tujuan PRIBADI = angka positif (chat orang), selain itu publik.
const TUJUAN = CHAT.split(",").map(x => x.trim()).filter(Boolean);
const pribadi = tj => /^\d+$/.test(tj);
async function kirim(teksUmum, teksPribadi, chat) {
  const daftar = chat ? [chat] : TUJUAN.length ? TUJUAN : ["(uji)"];
  let ok = false;
  for (const tj of daftar) {
    const teks = teksPribadi && (pribadi(tj) || tj === "(uji)") ? teksPribadi : teksUmum;
    if (DRY) { console.log(`---- (uji kering → ${tj === "(uji)" ? "pribadi" : pribadi(tj) ? "pribadi" : "publik"}) ----\n` + teks.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&") + "\n"); ok = true; continue; }
    // 2026-09-23: koneksi GitHub -> Telegram pernah ETIMEDOUT dan melempar galat yang MENGHENTIKAN seluruh
    // skrip (status tidak tersimpan). Sekarang: coba 3x (jeda 3/6 dtk, batas 15 dtk per coba); tetap gagal ->
    // dicatat & dilanjutkan; pesan itu tidak ditandai terkirim sehingga dicoba lagi di jalan berikutnya.
    let r = null;
    for (let coba = 1; coba <= 3 && !r; coba++) {
      try {
        r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15000),
          body: JSON.stringify({ chat_id: tj, text: teks, parse_mode: "HTML", disable_web_page_preview: true }) });
        if (r.status === 429 || r.status >= 500) { r = null; throw new Error("HTTP sibuk"); }
      } catch (e) {
        console.log(`Telegram tujuan ke-${TUJUAN.indexOf(tj) + 1} gagal (coba ${coba}/3): ${e.cause ? e.cause.code || e.message : e.message}`);
        if (coba < 3) await new Promise(res => setTimeout(res, 3000 * coba));
      }
    }
    if (!r) continue;
    if (r.ok) ok = true;
    else console.log(`Telegram menolak tujuan ke-${TUJUAN.indexOf(tj) + 1}: HTTP ${r.status}` + (r.status === 400 || r.status === 403 ? " (bot belum admin channel / id salah?)" : ""));
  }
  return ok;
}

// ---------- 5. rekap mingguan ----------
// ---------- 4. AUDIT OTOMATIS: beri tahu begitu pemantauan maju CUKUP DATA (>=30 trade & >=6 bulan).
// Sama persis dengan ambang "progres bukti" di app & rekap mingguan — sekali per pola + sekali
// keseluruhan, tidak diulang (ditandai di notif/audit.json). Lihat [[daya-statistik-30-trade]].
const AMBANG_N = 30, AMBANG_BULAN = 6;

// ---------- PEMBANDING PASIF untuk audit (saran #3 disetujui user, 2026-09-22) ----------
// Tanpa pembanding, bulan naik terlihat seperti sistem bagus. Untuk trade yang sudah tutup dihitung,
// dengan periode & lama pegang yang SAMA dan 1000 USDT sesudah biaya:
//   (a) tahan koin yang sama dari entry sampai bar keluar;  (b) tahan BTC selama itu;
//   (c) ENTRY ACAK di koin yang sama (200 set), jarak SL/TP1/TP2 & aturan keluar sama -> rata, p5, p95.
// Butuh lilin sejak MAJU_MULAI (bisa > 600 bar), diambil berhalaman hanya saat audit terpicu.
async function klSejak(k, sejak) {
  const out = []; let mulai = sejak;
  for (let p = 0; p < 6; p++) {
    const j = await getJ(`/api/v3/klines?symbol=${k}USDT&interval=4h&startTime=${mulai}&limit=1000`);
    if (!Array.isArray(j) || !j.length) break;
    out.push(...j); if (j.length < 1000) break; mulai = +j[j.length - 1][0] + 4 * 3600e3;
  }
  const b = out.filter(x => +x[6] < Date.now());
  return { t: b.map(x => +x[0]), o: b.map(x => +x[1]), h: b.map(x => +x[2]), l: b.map(x => +x[3]), c: b.map(x => +x[4]) };
}
const bawah = (d, t) => { let a = 0, b = d.t.length; while (a < b) { const m = (a + b) >> 1; if (d.t[m] < t) a = m + 1; else b = m; } return a; };
async function pembanding(tutup, cache) {
  const kl = async k => cache[k] || (cache[k] = await klSejak(k, MAJU_MULAI - 30 * 864e5));
  const btc = await kl("BTC"); if (!btc.t.length) return null;
  const idx = (d, t) => { const i = bawah(d, t); return i < d.t.length && d.t[i] === t ? i : -1; };
  const tahan = (d, i, j) => NOMINAL * (d.c[j] / d.c[i] - 1) - NOMINAL * BIAYA;
  const SET = 200, acak = new Array(SET).fill(0);
  let n = 0, sPola = 0, sKoin = 0, sBtc = 0, nAcak = 0;
  for (const tr of tutup) {
    const d = await kl(tr.koin); if (!d.t.length) continue;
    const i = idx(d, tr.masukT), j = idx(d, tr.keluarT), ib = idx(btc, tr.masukT), jb = idx(btc, tr.keluarT);
    if (i < 0 || j <= i || ib < 0 || jb <= ib) continue;
    n++; sPola += tr.usdt; sKoin += tahan(d, i, j); sBtc += tahan(btc, ib, jb);
    const i0 = Math.max(1, bawah(d, MAJU_MULAI)), i1 = d.t.length - 2; if (i1 <= i0) continue;
    nAcak++;
    const rel = { sl: tr.sl / tr.entry, tp1: tr.tp1 / tr.entry, tp2: tr.tp2 / tr.entry };
    for (let b = 0; b < SET; b++) {
      const r = i0 + Math.floor(Math.random() * (i1 - i0 + 1)), E = d.c[r];
      const s = simTahap(d, r, { entry: E, sl: E * rel.sl, tp1: E * rel.tp1, tp2: E * rel.tp2, trailP: tr.trailP || 0 });
      acak[b] += s.usdt != null ? s.usdt : s.real + s.sisa * NOMINAL * (d.c[d.c.length - 1] / E - 1) - NOMINAL * BIAYA;   // masih jalan: nilai di lilin terakhir
    }
  }
  if (n < 10 || !nAcak) return null;
  const a = acak.map(x => x / nAcak).sort((x, y) => x - y);
  return { n, pola: sPola / n, koin: sKoin / n, btc: sBtc / n, acak: a.reduce((x, y) => x + y, 0) / SET, p5: a[Math.floor(SET * .05)], p95: a[Math.floor(SET * .95)] };
}
function teksPembanding(P) {
  if (!P) return `\n📊 Pembanding pasif belum bisa dihitung (data lilin kurang).\n`;
  const f2 = v => (v >= 0 ? "+" : "") + v.toFixed(2);
  const vonis = P.pola > P.p95 ? "pola DI ATAS 95% entry acak — ada yang lebih dari sekadar arah pasar"
    : P.pola < P.p5 ? "pola DI BAWAH 95% entry acak — lebih buruk dari masuk sembarangan"
    : "pola TIDAK BEDA dari entry acak — hasilnya arah pasar, bukan polanya";
  return `\n📊 <b>Pembanding</b> (${P.n} trade, periode & lama pegang sama, 1000 USDT, sesudah biaya)\n` +
    `   Pola: <b>${f2(P.pola)}</b>/trade\n` +
    `   Tahan koin yang sama: ${f2(P.koin)}\n` +
    `   Tahan BTC: ${f2(P.btc)}\n` +
    `   Entry acak koin sama, SL/TP sama: rata ${f2(P.acak)} (p5 ${f2(P.p5)} · p95 ${f2(P.p95)})\n` +
    `   → <b>${vonis}</b>\n`;
}

async function cekAudit(maju) {
  const tutup = Object.values(maju).filter(t => t.st !== "jalan" && dipakaiBot(t.kode, t.macd));   // 2026-10-07: pola bot saja
  if (!tutup.length) return;
  let audit = {}; try { audit = JSON.parse(fs.readFileSync(F_AUDIT, "utf8")); } catch (e) {}
  if (AUDIT_PAKSA) audit = {};
  const skr = Date.now(), f2 = v => (v >= 0 ? "+" : "") + v.toFixed(2);
  const bulanSejak = arr => (skr - Math.min(...arr.map(t => t.masukT))) / (30.44 * 864e5);
  const cukup = arr => AUDIT_PAKSA || (arr.length >= AMBANG_N && bulanSejak(arr) >= AMBANG_BULAN);
  const cache = {};

  // keseluruhan
  const bln = bulanSejak(tutup);
  if (!audit.semua && cukup(tutup)) {
    const u = tutup.reduce((a, t) => a + t.usdt, 0), wr = Math.round(tutup.filter(t => t.usdt > 0).length / tutup.length * 100);
    const P = await pembanding(tutup, cache);
    await kirim(`<b>AMONK SINYAL · AUDIT</b>\n◻️◻️◻️◻️◻️\n` +
      `📐 Pemantauan maju SEMUA POLA kini <b>CUKUP DATA</b> (≥${AMBANG_N} trade & ≥${AMBANG_BULAN} bulan sejak 22/09/2026).\n\n` +
      `${tutup.length} trade tutup · ${bln.toFixed(1)} bulan · WR ${wr}%\n` +
      `Total: <b>${f2(u)} USDT</b> · rata ${f2(u / tutup.length)}/trade\n` +
      teksPembanding(P) +
      `\n<i>Ini pertama kali angka ini boleh dibaca sebagai kesimpulan, bukan sekadar pengamatan. Tetap bandingkan dengan uji panjang proyek (pola 4H historis ≈ impas) sebelum mengubah cara trading.</i>`);
    audit.semua = true;
  }

  // per pola
  const per = {};
  for (const t of tutup) (per[t.nama] = per[t.nama] || { kode: t.kode, arr: [] }).arr.push(t);
  audit.pola = audit.pola || {};
  for (const [nm, x] of Object.entries(per)) {
    if (audit.pola[nm] || !cukup(x.arr) || x.arr.length < 10) continue;
    const u = x.arr.reduce((a, t) => a + t.usdt, 0), wr = Math.round(x.arr.filter(t => t.usdt > 0).length / x.arr.length * 100);
    const P = await pembanding(x.arr, cache);
    await kirim(`<b>AMONK SINYAL · AUDIT</b>\n◻️◻️◻️◻️◻️\n` +
      `📐 Pola <b>${PERINGKAT(x.kode)} ${esc(nm)}</b> kini <b>CUKUP DATA</b> (≥${AMBANG_N} trade & ≥${AMBANG_BULAN} bulan).\n\n` +
      `${x.arr.length} trade tutup · ${bulanSejak(x.arr).toFixed(1)} bulan · WR ${wr}%\n` +
      `Total: <b>${f2(u)} USDT</b> · rata ${f2(u / x.arr.length)}/trade\n` +
      teksPembanding(P) +
      `\n<i>Baru sekarang pola ini boleh dinilai, bukan sebelumnya.</i>`);
    audit.pola[nm] = true;
  }
  if (!DRY) fs.writeFileSync(F_AUDIT, JSON.stringify(audit));
}

// ATURAN JEDA di rekap (2026-09-22, disetujui user). Trade NYATA tidak dibaca di sini (pesan ini juga ke
// channel publik), jadi dipakai keadaan pasar dari SEMUA sinyal minggu ini: bila >= JEDA_MIN_N tutup dan
// pecahan SL >= JEDA_SL_PCT% -> pasar tidak searah dengan long, saran jeda / ukuran setengah. Bukan sinyal.
// Aturan jeda dari trade nyata (rugi berturut, rugi 7 hari) ada di aplikasi, tab Akun.
const JEDA_SL_PCT = +(process.env.JEDA_SL_PCT || 60), JEDA_MIN_N = +(process.env.JEDA_MIN_N || 5);
function teksJeda(tutupMinggu, h) {
  if (tutupMinggu.length < JEDA_MIN_N) return `\n⏸ Disiplin: baru ${tutupMinggu.length} sinyal tutup minggu ini (kurang dari ${JEDA_MIN_N}) — belum bisa dinilai searah/tidak.\n`;
  const pctSl = Math.round(h.sl / tutupMinggu.length * 100);
  return pctSl >= JEDA_SL_PCT
    ? `\n⏸ <b>Disiplin: ${pctSl}% sinyal minggu ini kena SL</b> (batas ${JEDA_SL_PCT}%) — pasar sedang tidak searah dengan long. Saran: jeda seminggu atau ukuran setengah. Ini bukan tanda pola rusak.\n`
    : `\n▶ Disiplin: ${pctSl}% sinyal minggu ini kena SL (batas ${JEDA_SL_PCT}%) — tidak ada alasan jeda dari sisi pasar.\n`;
}

// ---------- 6. SCANNER HARIAN 4H & 1D (2026-09-22, permintaan user: "cara mencari koin yang akan
// terbentuk polanya setiap hari baik di tf 1 day maupun 4h ... kirim ke telegram") ----------
// Sekali sehari 00:17 UTC (07:17 WIB), sesudah lilin 1D dan 4H tutup. Dua pesan, satu per TF:
//   ✅ VALID yang harga-nya masih di area entry: <= +0.25R di atas entry, belum sentuh TP1/SL,
//      umur <= 20 hari (120 lilin 4H / 20 lilin 1D) — sama dengan jendela aplikasi.
//   ⏳ HAMPIR VALID: SETUP (pola terbentuk, menunggu lilin TUTUP di atas garis tembus) dan CALON
//      (lembah terakhir belum sah), urut jarak ke garis tembus.
// Aturan = pola_dc_peristiwa.cjs (sama dengan chart). Tidak menulis status/maju/audit apa pun.
// 1D TIDAK teruji menguntungkan (memori pola-1d-tidak-lebih-valid) -> ditulis di pesannya.
// JAM KIRIM (2026-09-22, user: "kirim jam 4 pagi waktu australia"): SCAN_JAM di zona SCAN_TZ
// (bawaan 04:00 Australia/Sydney). Cron GitHub hanya UTC dan tidak kenal daylight saving
// (Sydney UTC+10, mulai 4 Okt UTC+11), jadi workflow jalan tiap jam 16-21 UTC ("12 16-21 * * *")
// dan skrip ini sendiri yang memutuskan: kirim bila jam lokal = SCAN_JAM (boleh telat s.d. +2 jam
// kalau GitHub melewati satu run) dan hari itu belum terkirim (notif/scan.json). Run manual
// (input scan) selalu kirim dan tidak mencatat, jadi tidak menghalangi kiriman terjadwal.
const SCAN_TZ = process.env.SCAN_TZ || "Australia/Sydney", SCAN_JAM = +(process.env.SCAN_JAM || 4);
const SCAN_JADWAL = process.env.JADWAL === "12 16-21 * * *";
const SCAN = process.env.SCAN === "true" || SCAN_JADWAL;
const SCAN_MAKS = Math.max(1, +(process.env.SCAN_MAKS || 8));
const SCAN_AREA_R = 0.25;
const F_SCAN = path.join(__dirname, "scan.json");
const KOTA = SCAN_TZ.split("/").pop().replace(/_/g, " ");
function lokal(t) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: SCAN_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return { tgl: `${p.year}-${p.month}-${p.day}`, jam: +p.hour % 24, teks: `${p.day}/${p.month} ${String(+p.hour % 24).padStart(2, "0")}:${p.minute}` };
}
async function scanTF(k, tf) {
  const barMs = tf === "1d" ? 864e5 : 4 * 3600e3, umurMaks = tf === "1d" ? 20 : 120;
  const j = await getJ(`/api/v3/klines?symbol=${k}USDT&interval=${tf}&limit=${tf === "1d" ? 1000 : 600}`);
  if (!Array.isArray(j) || j.length < 120) return null;
  const skr = Date.now(), b = j.filter(x => +x[6] < skr);                        // buang lilin berjalan
  if (!b.length || skr - +b[b.length - 1][6] > 3 * barMs) return null;           // basi / delisting
  const d = { t: b.map(x => +x[0]), o: b.map(x => +x[1]), h: b.map(x => +x[2]), l: b.map(x => +x[3]), c: b.map(x => +x[4]), v: b.map(x => +x[5]) };
  const n = d.c.length, px = d.c[n - 1], vol = +b[n - 1][7] * (tf === "1d" ? 1 : 6);
  // ELLIOTT (EW) di 4H DAN 1D (user 2026-09-23: "ikuti juga di 1 day"); >=2H: ambang DC 2.5, kedalaman 0.90 = Pine
  let ev; try { ev = peristiwa(d, atrArr(d.h, d.l, d.c), { setupAkhir: true, calonAkhir: true, elliott: true }) || []; } catch (e) { return null; }
  const out = { valid: [], hampir: [], potensi: null }, macdKini = macdDi(d.c, n - 1);   // 2026-10-07: POTENSI NAIK tidak dikirim lagi
  for (const e of ev) {
    if (SEMBUNYI.has(e.kode) || !dipakaiBot(e.kode, e.kode === "FW" ? macdDi(d.c, e.i) : 0) || n - 1 - e.i > umurMaks) continue;
    const L = level(d, e); if (!L || !(L.sl > 0)) continue;
    let kena = false; for (let q = e.i + 1; q < n; q++) if (d.l[q] <= L.sl || d.h[q] >= L.tp1) { kena = true; break; }
    const r = (px - L.entry) / (L.entry - L.sl);
    if (kena || px <= L.sl || r > SCAN_AREA_R) continue;
    out.valid.push({ k, nama: e.nama, kode: e.kode, L, px, r, validT: d.t[e.i] + barMs, vol });
  }
  for (const [tahap, arr] of [["SETUP", ev.setup || []], ["CALON", ev.calon || []]]) for (const s of arr) {
    if (SEMBUNYI.has(s.kode) || !dipakaiBot(s.kode, macdKini)) continue;   // FW hampir valid: MACD lilin terakhir > 0 (perkiraan; bot menilai di lilin VALID)
    const E = s.level, S = s.batal, T2 = (E > S ? tpAturan(s.kode, E, S, s.level + s.tinggi).tp2 : s.level + s.tinggi);
    // pola tembus menunggu harga NAIK ke garis (px < E); Elliott menunggu harga TURUN ke limit (px > E)
    if (!(S > 0) || !(E > S) || !(T2 > E) || !(s.limit ? px > E : px < E)) continue;
    out.hampir.push({ k, tahap, nama: s.nama, kode: s.kode, E, S, T2, px, jarak: (E / px - 1) * 100, sisa: s.sisa, vol });
  }
  return out;
}
// ---------- 6b. POTENSI NAIK 4H (2026-10-04, user: "laporan setiap hari jam 4 pagi koin yang berpotensi ke telegram").
// BUKAN sinyal teruji: memakai satu-satunya ciri yang bertahan di riset proyek — kekuatan relatif lintas-koin (Q5-Q1 ~+0.057R per trade,
// nyata tapi di bawah biaya) — ditambah tren 4H & MACD. Skor (maks 8): tren (harga & EMA50 di atas EMA200) 2 · EMA200 naik 5 hari 1 ·
// garis MACD > 0 1 · lebih kuat dari median pasar 7 hari 1 (+1 bila 20% teratas) · 24 jam 1 · RSI > 78 −1 · likuiditas < 3 jt/24j −1.
// Lonjakan (> 60% di atas EMA200 4H) dipisah sebagai "sudah lari jauh", tidak masuk daftar.
const POTENSI_MAKS = Math.max(1, +(process.env.POTENSI_MAKS || 10));
const emaP = (c, n) => { if (c.length < n) return null; let e = c.slice(0, n).reduce((a, b) => a + b, 0) / n; const k = 2 / (n + 1); const o = [e]; for (let i = n; i < c.length; i++) { e = c[i] * k + e * (1 - k); o.push(e); } return o; };
function ciriPotensi(k, d, b) {
  const n = d.c.length; if (n < 260) return null;
  const px = d.c[n - 1], e50 = emaP(d.c, 50), e200 = emaP(d.c, 200), e12 = emaP(d.c, 12), e26 = emaP(d.c, 26), A = atrArr(d.h, d.l, d.c);
  const E50 = e50[e50.length - 1], E200 = e200[e200.length - 1], E200lalu = e200[e200.length - 31];
  if (!(E200 > 0) || !(A[n - 1] / px >= 0.002)) return null;                       // data kurang / stablecoin
  let g = 0, l = 0; for (let i = 1; i <= 14; i++) { const x = d.c[i] - d.c[i - 1]; if (x > 0) g += x; else l -= x; } g /= 14; l /= 14;
  for (let i = 15; i < n; i++) { const x = d.c[i] - d.c[i - 1]; g = (g * 13 + Math.max(x, 0)) / 14; l = (l * 13 + Math.max(-x, 0)) / 14; }
  let hi = -Infinity, lo = Infinity; for (let q = n - 42; q < n; q++) { hi = Math.max(hi, d.h[q]); lo = Math.min(lo, d.l[q]); }
  return { k, px, E50, E200, naikE200: E200 > E200lalu, macd: (e12[e12.length - 1] - e26[e26.length - 1]) / px, rsi: l === 0 ? 100 : 100 - 100 / (1 + g / l),
    r5: px / d.c[n - 7] - 1, r42: px / d.c[n - 43] - 1, likuid: b.slice(-6).reduce((a, x) => a + +x[7], 0), hi, lo };
}
function pesanPotensi(P) {
  const med = a => { const x = a.slice().sort((p, q) => p - q); return x.length ? x[x.length >> 1] : 0; };
  const m5 = med(P.map(x => x.r5)), m42 = med(P.map(x => x.r42)), p80 = P.map(x => x.r42 - m42).sort((a, b) => a - b)[Math.floor(P.length * 0.8)];
  for (const x of P) { x.kr5 = x.r5 - m5; x.kr42 = x.r42 - m42; x.dE200 = x.px / x.E200 - 1; x.dE50 = x.px / x.E50 - 1;
    x.skor = (x.px > x.E200 && x.E50 > x.E200 ? 2 : 0) + (x.naikE200 ? 1 : 0) + (x.macd > 0 ? 1 : 0) + (x.kr42 > 0 ? 1 : 0) + (x.kr42 >= p80 ? 1 : 0) + (x.kr5 > 0 ? 1 : 0) - (x.rsi > 78 ? 1 : 0) - (x.likuid < 3e6 ? 1 : 0); }
  const lari = P.filter(x => x.dE200 > 0.6).sort((a, b) => b.dE200 - a.dE200);
  const D = P.filter(x => x.dE200 <= 0.6 && x.skor >= 6).sort((a, b) => b.skor - a.skor || b.kr42 - a.kr42).slice(0, POTENSI_MAKS);
  const pr = x => (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%";
  const baris = D.map((x, i) => `${i + 1}. <b>${esc(x.k)}</b> ${fx(x.px)} · skor ${x.skor}/8 · RSI ${x.rsi.toFixed(0)}\n` +
    `   vs pasar 7h <b>${pr(x.kr42)}</b> · 24j ${pr(x.kr5)} · EMA200 ${pr(x.dE200)} · EMA50 ${pr(x.dE50)}${x.dE50 <= 0.03 && x.dE50 >= 0 ? " 🎯 dekat EMA50" : ""}\n` +
    `   puncak 7h ${fx(x.hi)} · dasar 7h ${fx(x.lo)}${x.likuid < 3e6 ? " · ⚠️ likuiditas tipis" : ""} · ${tautan(x.k)}`).join("\n");
  return `<b>AMONK · POTENSI NAIK 4H</b>\n◻️◻️◻️◻️◻️\n📅 ${lokal(Date.now()).teks} waktu ${esc(KOTA)} · ${P.length} koin\n` +
    `Pasar: ${P.filter(x => x.dE200 > 0).length}/${P.length} koin di atas EMA200 4H · median 7 hari ${pr(m42)} · 24 jam ${pr(m5)}\n\n` +
    `💪 <b>Paling kuat & tren rapi</b> (skor ≥ 6 dari 8): ${D.length}\n${baris || "   — tidak ada"}\n\n` +
    (lari.length ? `🚀 <b>Sudah lari jauh</b> (> 60% di atas EMA200, rawan balik): ${lari.slice(0, 5).map(x => esc(x.k) + " " + pr(x.dE200)).join(" · ")}\n\n` : "") +
    `<i>Bukan sinyal beli. Skor = tren 4H + MACD + lebih kuat dari pasar. DIUJI 04-10 (2019-2026, 4 kelompok koin): daftar ini TIDAK konsisten mengalahkan koin acak dalam 1-7 hari (menang di 1 kelompok, kalah di 2) — anggap peta kekuatan, bukan ramalan. Koin di sini sudah naik, jadi masuk sekarang berarti mengejar. 🎯 = harga ≤ 3% di atas EMA50 4H (area retest selama tren utuh). Tembus puncak 7h = kekuatan berlanjut; kembali ke dasar 7h = gagal.</i>`;
}
function pesanScan(tf, V, H, dicek) {
  const tfT = tf === "1d" ? "1D" : "4H", tipis = x => x.vol < 1e6 ? " ⚠️tipis" : "";
  const bV = V.sort((a, b) => a.r - b.r).slice(0, SCAN_MAKS).map(x =>
    `• <b>${esc(x.k)}</b> ${PERINGKAT(x.kode)} ${esc(x.nama)} · valid ${lokal(x.validT).teks.slice(0, 5)}\n` +
    `   E ${fx(x.L.entry)} (kini ${pc(x.px, x.L.entry)}) · SL ${fx(x.L.sl)} (${pc(x.L.sl, x.L.entry)}) · ${x.kode === "TB" ? "tanpa TP1 · trailing " + Math.round(TB_MURNI_P * 100) + "% murni" : "TP1 " + fx(x.L.tp1) + " · " + (x.L.trailP ? "sisa trailing " + Math.round(x.L.trailP * 100) + "%" : "TP2 " + fx(x.L.tp2))}${tipis(x)}`).join("\n");
  const bH = H.sort((a, b) => Math.abs(a.jarak) - Math.abs(b.jarak)).slice(0, SCAN_MAKS).map(x =>
    `• <b>${esc(x.k)}</b> ${PERINGKAT(x.kode)} ${esc(x.nama)}${x.tahap === "CALON" ? " <i>(calon)</i>" : ""} · ${x.kode === "EW" ? "limit beli" : "tembus"} ${fx(x.E)} (<b>${x.jarak >= 0 ? "+" : ""}${x.jarak.toFixed(1)}%</b>)\n` +
    `   SL ${fx(x.S)} (${pc(x.S, x.E)}) · ${x.kode === "TB" ? "tanpa TP1 · trailing " + Math.round(TB_MURNI_P * 100) + "% murni" : TRAIL_K.has(x.kode) ? "sisa trailing " + Math.round(TRAIL_P * 100) + "%" : "TP2 " + fx(x.T2) + " (" + pc(x.T2, x.E) + ")"}${tipis(x)}`).join("\n");
  return `<b>AMONK SINYAL · SCAN HARIAN ${tfT}</b>\n◻️◻️◻️◻️◻️\n📅 ${lokal(Date.now()).teks} waktu ${esc(KOTA)} · ${dicek} koin\n\n` +
    `✅ <b>Valid, masih di area entry</b> (≤ +${SCAN_AREA_R}R, belum TP1/SL): ${V.length}\n${bV || "   — tidak ada"}` +
    (V.length > SCAN_MAKS ? `\n   … +${V.length - SCAN_MAKS} lagi` : "") + `\n\n` +
    `⏳ <b>Hampir valid</b> — menunggu lilin ${tfT} TUTUP di atas garis tembus: ${H.length}\n${bH || "   — tidak ada"}` +
    (H.length > SCAN_MAKS ? `\n   … +${H.length - SCAN_MAKS} lagi` : "") + `\n\n` +
    `<i>Hampir valid BELUM sinyal: entry hanya sesudah lilin tutup di atas garis tembus. Calon = lembah terakhir belum sah, bisa berubah. Elliott Wave = limit beli: entry saat harga TURUN menyentuh limit (batal bila 60 lilin tak tersentuh).` +
    (tf === "1d" ? ` LAPORAN SAJA: sinyal utama AMONK di 4H. Isinya pola sinyal AMONK (TB, FW bila MACD 1D > 0, EW). Pola 1D di uji proyek tidak lebih baik dari entry acak; SL 1D lebar.` : ` Hanya pola sinyal AMONK (TB, FW bila MACD>0, EW). Level: TB trailing ${Math.round(TB_MURNI_P * 100)}% murni; FW & EW 50% TP1, SL ke entry, sisa trailing ${Math.round(TRAIL_P * 100)}%.`) + `</i>`;
}
async function scanHarian() {
  const L0 = lokal(Date.now());
  if (SCAN_JADWAL && process.env.SCAN !== "true") {
    let st = {}; try { st = JSON.parse(fs.readFileSync(F_SCAN, "utf8")); } catch (e) {}
    if (st.tgl === L0.tgl) { console.log(`SCAN: sudah terkirim hari ini (${L0.tgl}, ${SCAN_TZ})`); return; }
    if (L0.jam < SCAN_JAM || L0.jam > SCAN_JAM + 2) { console.log(`SCAN: belum jamnya (${SCAN_TZ} pukul ${L0.jam}, target ${SCAN_JAM})`); return; }
  }
  const hasil = { "4h": { V: [], H: [], n: 0 }, "1d": { V: [], H: [], n: 0 } }, POT = [];
  for (const k of KOIN) for (const tf of ["4h", "1d"]) {   // 2026-10-07 (user): 1D tetap sebagai LAPORAN, isinya hanya pola bot
    const r = await scanTF(k, tf); if (!r) continue;
    hasil[tf].n++; hasil[tf].V.push(...r.valid); hasil[tf].H.push(...r.hampir); if (r.potensi) POT.push(r.potensi);
  }
  let terkirimSatu = false;
  for (const tf of ["4h", "1d"]) {
    const x = hasil[tf], ok = await kirim(pesanScan(tf, x.V, x.H, x.n));
    console.log(`SCAN ${tf}: ${x.n} koin · valid di area entry ${x.V.length} · hampir valid ${x.H.length} · ${ok ? "terkirim" : "GAGAL"}`);
    if (ok) terkirimSatu = true;
  }
  // 6b. potensi naik 4H (pesan ketiga)
  if (false && POT.length >= 30) {   // 2026-10-07: dimatikan (bukan sinyal bot)
    const ok = await kirim(pesanPotensi(POT)); console.log("POTENSI NAIK 4H: " + POT.length + " koin · " + (ok ? "terkirim" : "GAGAL")); if (ok) terkirimSatu = true; }
  if (SCAN_JADWAL && process.env.SCAN !== "true" && terkirimSatu && !DRY) fs.writeFileSync(F_SCAN, JSON.stringify({ tgl: L0.tgl, t: Date.now(), tz: SCAN_TZ }));
}

// 2026-10-04: bagian TIM RISET · AGEN PAPER · KESEHATAN SISTEM di rekap mingguan (data: cabang status, ditulis pemantau laptop)
async function teksTimSehat() {
  let T; try { const r = await fetch("https://raw.githubusercontent.com/AmonkShark/Amonk/status/dewan_status.json", { signal: AbortSignal.timeout(15000) }); if (!r.ok) throw 0; T = await r.json(); }
  catch (e) { return "\n🧑‍🔬 <b>Tim riset & Agen Paper</b>: status laptop tidak terbaca\n"; }
  const R = T.riwayat || {}, P = T.paper || {}, S = T.sistem || {}, rr = x => x == null ? "—" : (x > 0 ? "+" : "") + x + "R";
  const jam = iso => iso ? (Date.now() - Date.parse(iso)) / 3600e3 : 1e9;
  let t = "\n🧑‍🔬 <b>Tim riset</b>: " + (R.diuji || 0) + " gagasan diuji · lolos " + (R.lolos || 0) + (R.eksploratif ? " (+" + R.eksploratif + " eksploratif)" : "") + " · gagal " + (R.gagal || 0) + "\n";
  if (P.juara) { t += "📄 <b>Agen Paper</b> (simulasi kertas): juara " + esc(P.juara.id) + " " + P.juara.tutup + " trade · " + rr(P.juara.avgR) + "/trade · kertas " + P.juara.usdt + " USDT\n";
    if (P.penantang) t += "   penantang " + esc(P.penantang.id) + ": " + P.penantang.tutup + "/30 trade · " + rr(P.penantang.avgR) + " · minggu " + P.penantang.minggu + "/8\n"; }
  const cek = [["laptop/pemantau", jam(S.pantau) > 0.4], ["rutin mekanis 4H", jam(S.mekanis && S.mekanis.t) > 4.4 || !!(S.mekanis && !S.mekanis.ok)], ["rutin Claude", jam(S.scanClaude && S.scanClaude.t) > 4.9],
    ["tim riset", jam(S.dewan && S.dewan.t) > 2.5], ["daftar Monitoring Tag", jam(S.mtag && S.mtag.t) > 36]].filter(x => x[1]).map(x => x[0]);
  t += cek.length ? "⚠️ <b>Perlu dicek</b>: " + cek.join(", ") + " (lihat Akun → Kesehatan sistem)\n" : "🟢 Kesehatan sistem: semua normal\n";
  return t;
}

async function rekap() {
  let maju = {}; try { maju = JSON.parse(fs.readFileSync(F_MAJU, "utf8")); } catch (e) {}
  const semua = Object.values(maju).filter(t => dipakaiBot(t.kode, t.macd)), skr = Date.now(), awal = skr - 7 * 864e5;   // 2026-10-06: TB/FW/EW saja
  const f2 = v => (v >= 0 ? "+" : "") + v.toFixed(2);
  const baru = semua.filter(t => t.masukT >= awal);
  const tutupMinggu = semua.filter(t => t.st !== "jalan" && t.keluarT >= awal);
  const tutupSemua = semua.filter(t => t.st !== "jalan");
  const jalan = semua.filter(t => t.st === "jalan");
  const hit = arr => ({ tp2: arr.filter(t => t.st === "TP2").length, be: arr.filter(t => t.st === "BE").length, sl: arr.filter(t => t.st === "SL").length });
  const tot = arr => arr.reduce((a, t) => a + t.usdt, 0);
  const h = hit(tutupMinggu), hs = hit(tutupSemua);
  const bulan = tutupSemua.length ? (skr - Math.min(...semua.map(t => t.masukT))) / (30.44 * 864e5) : 0;
  const per = {};
  for (const t of tutupSemua) { const x = per[t.nama] = per[t.nama] || { n: 0, u: 0, kode: t.kode }; x.n++; x.u += t.usdt; }
  const baris = Object.entries(per).sort((a, b) => b[1].u - a[1].u).slice(0, 6)
    .map(([nm, x]) => `   ${PERINGKAT(x.kode)} ${esc(nm)}: ${x.n}× · ${f2(x.u)} USDT`).join("\n");
  const teks =
    `<b>AMONK SINYAL · REKAP MINGGUAN</b>\n<i>SIMULASI 1000 USDT per trade dari pola chart</i>\n◻️◻️◻️◻️◻️\n` +
    `📅 ${wib(awal).slice(0, 5)} – ${wib(skr).slice(0, 5)}\n\n` +
    `🆕 Pola baru minggu ini: <b>${baru.length}</b>\n` +
    `✅ Tutup minggu ini: <b>${tutupMinggu.length}</b> (TP1+TP2 ${h.tp2} · TP1+BE ${h.be} · SL ${h.sl})\n` +
    `💵 Hasil tutup minggu ini: <b>${f2(tot(tutupMinggu))} USDT</b> (1000 USDT/trade, sesudah biaya)\n` +
    `⏳ Masih jalan: ${jalan.length}\n\n` +
    `📈 <b>Sejak 22/09 (pemantauan maju)</b>\n` +
    `   ${tutupSemua.length} tutup · WR ${tutupSemua.length ? Math.round(tutupSemua.filter(t => t.usdt > 0).length / tutupSemua.length * 100) : 0}% · total <b>${f2(tot(tutupSemua))} USDT</b>` +
    (tutupSemua.length ? ` · rata ${f2(tot(tutupSemua) / tutupSemua.length)}/trade` : "") + `\n` +
    `   (TP1+TP2 ${hs.tp2} · TP1+BE ${hs.be} · SL ${hs.sl})\n` +
    `   progres bukti: ${tutupSemua.length}/30 trade · ${bulan.toFixed(1)}/6 bulan — ${tutupSemua.length >= 30 && bulan >= 6 ? "cukup data" : "<i>belum cukup data untuk disimpulkan</i>"}\n` +
    (baris ? `\n🏷 Per pola (maju):\n${baris}\n` : "") +
    teksJeda(tutupMinggu, h) + await teksTimSehat();
  const ok = await kirim(teks);
  console.log(`REKAP: ${ok ? "terkirim" : "GAGAL"} (${semua.length} trade maju tercatat)`);
}

(async () => {
  // Pasang pertama: belum ada chat id -> kirim chat id ke obrolan bot sendiri (tidak ke log).
  if (!DRY && !CHAT) {
    const u = await (await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates`)).json().catch(() => ({}));
    const m = (u.result || []).map(x => x.message || x.channel_post).filter(Boolean).pop();
    if (!m) { console.log("TELEGRAM_CHAT belum diisi dan bot belum menerima pesan. Kirim /start ke bot dulu, lalu jalankan ulang."); return; }
    await kirim(`✅ Bot AMONK tersambung.\nChat ID kamu: <code>${m.chat.id}</code>\nSimpan angka ini sebagai secret <b>TELEGRAM_CHAT</b> di GitHub, lalu jalankan workflow sekali lagi.`, null, m.chat.id);
    console.log("Chat id dikirim ke obrolan bot (tidak dicetak di log).");
    return;
  }
  if (REKAP) return rekap();
  if (SCAN) return scanHarian();

  let status = {}; try { status = JSON.parse(fs.readFileSync(F_STATUS, "utf8")); } catch (e) {}
  for (const [kk, v] of Object.entries(status)) if (typeof v === "number") status[kk] = { t: v, tahap: "baru" };   // format lama
  let maju = {}; try { maju = JSON.parse(fs.readFileSync(F_MAJU, "utf8")); } catch (e) {}
  const M = TUJUAN.some(pribadi) || DRY ? await ambilModal() : null;
  const sekarang = Date.now();
  let baru = 0, keluar = 0, dicek = 0, calonUji = null, baru1D = 0, baruLab = 0;

  for (const k of KOIN) {
    if (!UJI && TF1D_AKTIF) baru1D += await cek1D(k, status, M, sekarang);
    const j = await getJ(`/api/v3/klines?symbol=${k}USDT&interval=4h&limit=600`);
    if (!Array.isArray(j) || j.length < 250) continue;
    const b = j.filter(x => +x[6] < sekarang);                                    // buang lilin berjalan
    if (!b.length || sekarang - +b[b.length - 1][6] > 12 * 3600e3) continue;       // koin basi/delisting
    dicek++;
    const d = { t: b.map(x => +x[0]), o: b.map(x => +x[1]), h: b.map(x => +x[2]), l: b.map(x => +x[3]), c: b.map(x => +x[4]), v: b.map(x => +x[5]) };
    let ev = []; try { ev = peristiwa(d, atrArr(d.h, d.l, d.c), { elliott: true }) || []; } catch (e) { continue; }
    ev = ev.filter(e => !SEMBUNYI.has(e.kode));
    if (!UJI) {                                                      // 1a. setup Elliott baru (sekali per setup)
      let S = null; try { S = elliott(d, atrArr(d.h, d.l, d.c), 2.5).setup; } catch (e) { S = null; }
      const nB = d.c.length;
      if (S && S.umur < JENDELA_BAR && d.c[nB - 1] > S.level) {
        const kS = `EWSETUP|${k}|${d.t[S.lahirB]}`;
        if (!status[kS]) {
          const LS = { entry: S.level, sl: S.batal, tp2: S.level + S.tinggi, trailP: TRAIL_P };
          LS.tp1 = LS.entry + 0.5 * (LS.entry - LS.sl); if (LS.tp1 >= LS.tp2) LS.tp1 = LS.entry + 0.5 * (LS.tp2 - LS.entry);
          const volS = d.v.slice(-6).reduce((a, x, q) => a + x * d.c[nB - 6 + q], 0);
          if (LS.sl > 0 && await kirim(pesanSetupEw(k, S, d, volS, simTeks(LS)), pesanSetupEw(k, S, d, volS, ukuranTeks(LS, M)))) status[kS] = { t: sekarang, tahap: "tutup" };
        }
      }
    }
    const n = d.c.length, vol = d.v.slice(-6).reduce((a, x, q) => a + x * d.c[n - 6 + q], 0);
    if (UJI) { const e = ev[ev.length - 1]; if (e && (!calonUji || d.t[e.i] > calonUji.t)) calonUji = { t: d.t[e.i], k, d, e, vol }; continue; }

    for (const e of ev) {
      const L = level(d, e); if (!L) continue;
      const kunci = `${k}|${e.nama}|${d.t[e.i]}`, validT = d.t[e.i] + 4 * 3600e3;
      const s = simTahap(d, e.i, L); prkCatat(e.kode, s);
      // catatan maju (untuk rekap): semua pola sejak MAJU_MULAI; yang sudah tutup dibekukan
      if (d.t[e.i] >= MAJU_MULAI && !(maju[kunci] && maju[kunci].st !== "jalan"))
        maju[kunci] = { koin: k, nama: e.nama, kode: e.kode, masukT: d.t[e.i], entry: L.entry, sl: L.sl, tp1: L.tp1, tp2: L.tp2,
          st: s.st, kenaTp1: s.kenaTp1, keluarT: s.keluarT, usdt: s.usdt, ...(e.kode === "FW" ? { macd: macdDi(d.c, e.i) } : {}) };
      else if (e.kode === "FW" && maju[kunci] && maju[kunci].macd === undefined) maju[kunci].macd = macdDi(d.c, e.i);   // isi susulan catatan lama
      if (!TG_TAMPIL.has(e.kode)) continue;   // ST/AT: dicatat, tidak dikirim (2026-10-06)
      // 1. pola baru
      if (e.i >= n - JENDELA_BAR && !status[kunci]) {
        if (!dipakaiBot(e.kode, e.kode === "FW" ? macdDi(d.c, e.i) : 0)) { status[kunci] = { t: sekarang, tahap: "tutup", lewat: "FW MACD<=0" }; continue; }   // FW yang dilewati bot: tidak dikirim
        if (await kirim(pesanBaru(k, e, L, d, vol, false, simTeks(L)), pesanBaru(k, e, L, d, vol, false, ukuranTeks(L, M)))) {
          status[kunci] = { t: sekarang, tahap: "baru" }; baru++;
        }
        continue;
      }
      // 2. exit untuk pola yang pernah dikirim
      const S = status[kunci];
      if (!S || S.tahap === "tutup") continue;
      let jenis = null, tahapBaru = S.tahap;
      if (s.st === "SL") { jenis = "SL"; tahapBaru = "tutup"; }
      else if (s.st === "TP2") { jenis = s.trail ? "TRAIL" : S.tahap === "tp1" ? "TP2" : "TP1TP2"; tahapBaru = "tutup"; }
      else if (s.st === "BE") { jenis = S.tahap === "tp1" ? "BE" : "TP1BE"; tahapBaru = "tutup"; }
      else if (s.kenaTp1 && S.tahap === "baru") { jenis = "TP1"; tahapBaru = "tp1"; }
      if (jenis && await kirim(pesanExit(k, e.nama, e.kode, L, s, jenis, validT))) { S.tahap = tahapBaru; S.u = sekarang; keluar++; }
    }
    // 3. SINYAL LAB L030 & L027 (2026-10-06): baru (lilin sinyal di N lilin tutup terakhir), TP1, tutup — sekali per tahap
    let LS = null; try { LS = LAB.sinyalLab(d); } catch (e) { LS = null; }
    if (LS) for (const kode of LAB.LAB_KODE) {
      const T = LS[kode] || []; for (const t of T.slice(-3)) {   // 3 trade terakhir: trade lama yang baru tutup tetap dapat pesan TUTUP
      const kunci = `LAB|${k}|${kode}|${t.masukT}`, iBar = d.t.indexOf(t.masukT), S0 = status[kunci];
      if (!S0) { if (t === T[T.length - 1] && t.st === "jalan" && iBar >= n - JENDELA_BAR && await kirim(pesanLab(k, t, "BARU"))) { status[kunci] = { t: sekarang, tahap: t.kenaTp1 ? "tp1" : "baru" }; baruLab++; } continue; }
      if (S0.tahap === "tutup") continue;
      const jenis = t.st !== "jalan" ? "TUTUP" : t.kenaTp1 && S0.tahap === "baru" ? "TP1" : null;
      if (jenis && await kirim(pesanLab(k, t, jenis))) { S0.tahap = jenis === "TUTUP" ? "tutup" : "tp1"; S0.u = sekarang; keluar++; }
    } }
  }

  if (UJI) {
    if (!calonUji) { console.log("UJI: tidak ada pola valid di jendela data"); return; }
    const { k, d, e, vol } = calonUji, L = level(d, e);
    const ok = await kirim(pesanBaru(k, e, L, d, vol, true, simTeks(L)), pesanBaru(k, e, L, d, vol, true, ukuranTeks(L, M)));
    console.log(`UJI: pesan ${ok ? "terkirim" : "GAGAL"} (${dicek} koin dicek, ukuran posisi: ${M ? M.sumber : "tidak ada modal"})`);
    return;
  }
  // bersihkan: status > 60 hari, catatan maju tetap (itu buku)
  for (const [kk, v] of Object.entries(status)) if (sekarang - v.t > 60 * 864e5) delete status[kk];
  await cekAudit(maju); prkSimpan();
  if (!DRY) { fs.writeFileSync(F_STATUS, JSON.stringify(status)); fs.writeFileSync(F_MAJU, JSON.stringify(maju)); }
  console.log(`selesai: ${dicek} koin dicek, ${baru} pola baru 4H, ${baru1D} pola baru 1D, ${baruLab} sinyal Lab baru, ${keluar} update exit ${DRY ? "(uji kering, tidak dikirim)" : "terkirim"} · catatan maju ${Object.keys(maju).length} · ukuran posisi: ${M ? M.sumber : "tanpa modal"}`);
})();
