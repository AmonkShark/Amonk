/**
 * FIB 1H untuk BOT TESTNET (2026-09-22, permintaan user: "buat di amonk panel agar aku bisa centang juga
 * untuk fib"). Dijalankan GitHub Actions tiap jam (.github/workflows/fib.yml), TANPA alert TradingView.
 *
 * Aturan = versi TANPA LOOKAHEAD yang diuji hari ini (research/PRADAFTAR_fib1h_limit_jual_close.md):
 *   setup  = modul fwd12/deteksi_gz_fib.cjs (FIB_1h: pivot K=5, ayunan >= 30%, fib 0.85, umur 120, jeda 12)
 *   order  = LIMIT di p, dipasang sesudah lilin kelahiran setup tutup; gugur bila close < dasar / umur habis
 *   isian  = di close lilin isian: close < dasar ATAU close <= EMA200 ATAU jarak > 3% -> BOT menjual di close
 *            selain itu SL p − 1 ATR (ATR lilin sebelum isian), TP p + 2R, batas 60 lilin
 * Status: EKSPLORATIF (+0.15..+0.19R, 2025-26 ~+0.06R), konfirmasi tidak independen — lihat memori.
 *
 * Skrip ini HANYA menghitung & mengirim keadaan pasar ke bot (POST /fib). Order dipasang oleh bot.
 * Isi kiriman per koin: setup yang berlaku untuk lilin BERIKUTNYA (atau null) + 3 lilin tutup terakhir
 * {t, c, e(EMA200)} supaya bot bisa menilai syarat close lilin isian.
 * Rahasia GitHub: BOT_URL (https://amonk-bot....workers.dev), BOT_KUNCI (= WEBHOOK_KUNCI di Cloudflare).
 * DRY=1 atau tanpa BOT_URL: hanya mencetak.
 */
const M = require("./deteksi_gz_fib.cjs");
const U = require("./universe_gabungan.json");
const KOIN = (U.koin || U).map(s => String(s).toUpperCase());
const V = M.VARIAN.find(v => v.nama === "FIB_1h"), F = M.FIB_UMUM;
const BOT_URL = (process.env.BOT_URL || "").replace(/\/+$/, ""), BOT_KUNCI = process.env.BOT_KUNCI || "";
const DRY = process.env.DRY === "1" || !BOT_URL || !BOT_KUNCI;
const HOSTS = ["https://data-api.binance.vision", "https://api.binance.com", "https://api-gcp.binance.com"];
async function getJ(p) { for (const h of HOSTS) { try { const r = await fetch(h + p); if (r.ok) return r.json(); if (r.status === 400) return null; } catch (e) {} } return null; }

// Mesin yang SAMA dengan simulasi uji (limit + jual di close). Mengembalikan keadaan sesudah lilin terakhir.
function keadaan(B) {
  const { t, h, l, c } = B, K = V.K, akhir = c.length - 1;
  const pvH = i => { for (let j = i - K; j <= i + K; j++) if (j !== i && h[j] >= h[i]) return false; return true; };
  const pvL = i => { for (let j = i - K; j <= i + K; j++) if (j !== i && l[j] <= l[i]) return false; return true; };
  let lowT = null, tipe = null, setup = null, last = -1e15;
  const adaSetup = new Array(c.length).fill(false);       // setup hidup SESUDAH lilin ini tutup
  const isian = [];
  // pivot di indeks i baru pasti sesudah lilin i+K tutup; lilin terakhir yang boleh dipakai = akhir
  for (let bi = K; bi <= akhir; bi++) {
    const i = bi - K;
    if (setup && bi > setup.lahir && t[bi] - last >= V.jeda * 3600e3 && B.atr[bi - 1] > 0) {
      const p = setup.atas - setup.leg * F.fib;
      if (l[bi] <= p && h[bi] >= p) { last = t[bi]; isian.push({ t: t[bi], p }); setup = null; }
    }
    if (i >= K) {
      if (pvL(i)) { if (tipe !== "L" || lowT == null || l[i] < lowT) lowT = l[i]; tipe = "L"; }
      if (pvH(i) && lowT != null && lowT > 0) { const leg = h[i] - lowT; if (leg > 0 && leg / lowT * 100 >= F.minLeg) setup = { atas: h[i], leg, bawah: lowT, lahir: bi }; tipe = "H"; }
    }
    if (setup && (c[bi] < setup.bawah || (bi - setup.lahir) > V.umur)) setup = null;
    adaSetup[bi] = !!setup;
  }
  // setup berlaku untuk lilin BERIKUTNYA hanya kalau jeda sudah lewat saat lilin itu dibuka
  const tBerikut = t[akhir] + 3600e3;
  const berlaku = setup && tBerikut - last >= V.jeda * 3600e3 && B.atr[akhir] > 0 && B.e200[akhir] > 0;
  return { setup: berlaku ? { p: setup.atas - setup.leg * F.fib, bawah: setup.bawah, atas: setup.atas, R: F.slAtr * B.atr[akhir],
             ayunan: +(setup.leg / setup.bawah * 100).toFixed(1), lahirT: t[setup.lahir] } : null,
           relevan: adaSetup.slice(-4).some(Boolean) || isian.some(x => x.t >= t[akhir] - 3 * 3600e3) };
}

(async () => {
  const sekarang = Date.now(), koin = [];
  let dicek = 0;
  for (const k of KOIN) {
    const j = await getJ(`/api/v3/klines?symbol=${k}USDT&interval=1h&limit=1000`);
    if (!Array.isArray(j) || j.length < 400) continue;
    const b = j.filter(x => +x[6] < sekarang);                                  // buang lilin berjalan
    if (!b.length || sekarang - +b[b.length - 1][6] > 3 * 3600e3) continue;
    const B = { t: b.map(x => +x[0]), o: b.map(x => +x[1]), h: b.map(x => +x[2]), l: b.map(x => +x[3]), c: b.map(x => +x[4]) };
    B.e200 = M.ema(B.c, 200); B.atr = M.atrW(B.h, B.l, B.c);
    dicek++;
    const K = keadaan(B);
    if (!K.setup && !K.relevan) continue;
    const n = B.c.length;
    koin.push({ sym: k + "USDT", setup: K.setup, bars: [n - 3, n - 2, n - 1].map(i => ({ t: B.t[i], c: B.c[i], e: B.e200[i] })) });
  }
  const isi = { t: sekarang, aturan: { fib: F.fib, ayunanMin: F.minLeg, maksEma: F.maksEma, slAtr: F.slAtr, tpR: F.tpR, batasLilin: V.batas }, dicek, koin };
  const nSetup = koin.filter(x => x.setup).length;
  if (DRY) { console.log(`DRY: ${dicek} koin dicek, ${nSetup} setup aktif, ${koin.length} koin dikirim`); for (const x of koin.filter(x => x.setup).slice(0, 10)) console.log(JSON.stringify({ sym: x.sym, ...x.setup })); return; }
  const r = await fetch(`${BOT_URL}/fib?k=${encodeURIComponent(BOT_KUNCI)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isi) });
  console.log(`FIB 1H: ${dicek} koin dicek, ${nSetup} setup aktif, kirim ke bot: HTTP ${r.status} ${(await r.text()).slice(0, 80)}`);
  if (!r.ok) process.exitCode = 1;
})();
