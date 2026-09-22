/**
 * MODUL BERSAMA — deteksi GZ, FIB, dan FIB20 di 1H maupun 4H.
 *
 * KENAPA MODUL, BUKAN SALINAN. Dua pembukuan memakai aturan yang sama persis:
 *   fwd_varian_bf22.cjs   backfill retrospektif sejak 2026-08-22
 *   analisa_gz_fib.cjs    forward test "ANALISA SINYAL GZ & FIB"
 * Kalau masing-masing menyimpan salinan deteksinya sendiri, satu bisa diperbaiki
 * dan satunya tidak, lalu keduanya diam-diam mengukur aturan yang BERBEDA sambil
 * tampak sebanding. Itu persis kesalahan yang sudah terjadi di proyek ini (fwd_fib
 * tanpa saringan EMA200 sementara Pine memakainya). Satu berkas, satu kebenaran.
 *
 * Angka di sini berasal dari pra-daftar yang ditulis SEBELUM hasilnya dilihat.
 * TIDAK BOLEH DIGESER tanpa pra-daftar baru.
 */
const JAM = 3600000;
const MS = { "1h": JAM, "4h": 4 * JAM };
const BIAYA = 0.004;                 // komisi 0.4%, sama dengan fwd57.cjs

// FIB: parameter yang sama untuk semua varian FIB; yang berbeda hanya K/umur/jeda/batas.
const FIB_UMUM = { minLeg: 30, fib: 0.850, maksEma: 3.0, slAtr: 1.0, tpR: 2.0 };

// GZ: replika amonk_levels.pine, identik dengan blok GZ di fwd57.cjs.
// Filter BTC dimatikan di sana (diuji: membuang 28-34% sinyal tanpa memperbaiki hasil).
const GZ = { pivK: 5, minLeg: 30, fibE: 0.618, tol: 0.5, ekor: 1.5,
             umur: 120, sl: 2.0, tp: 1.5, jeda: 48, batas: Infinity };

// GZ_1h & GZ_4h DIHIDUPKAN LAGI 2026-09-02 atas perintah user ("hidupkan cuma jangan
// munculkan di script"). Dua hal yang dimaksud dan dijalankan:
//   1. HIDUP  — kedua varian kembali dipindai dan dibukukan di analisa_gz_fib.cjs.
//   2. TIDAK MUNCUL DI SCRIPT — tidak ada berkas Pine yang disentuh. GZ tidak digambar,
//      tidak memicu alert, dan tidak menambah objek apa pun ke chart. Pembukuan ini
//      murni Node + Binance API, persis seperti FIB.
//
// `sejak` = lantai TANPA BACKFILL milik varian ini sendiri, dipakai HANYA oleh
// analisa_gz_fib.cjs. Buku itu berjalan sejak 2026-08-30T05:00Z, sedangkan GZ berhenti
// dipindai 2026-09-01. Tanpa lantai ini, jalan pertama sesudah dihidupkan akan menyedot
// sinyal 01-02 September yang hasilnya SUDAH terjadi - backfill yang menyamar jadi
// forward test, di buku yang seluruh artinya bergantung pada tidak adanya backfill.
// fwd_varian_bf22.cjs sengaja MENGABAIKAN `sejak`: buku itu backfill dari desainnya.
const GZ_HIDUP_LAGI_MS = Date.parse("2026-09-02T04:00:00Z");

const VARIAN = [
  { nama: "GZ_1h",    jenis: "GZ",  tf: "1h", uni: "A", sejak: GZ_HIDUP_LAGI_MS,
    harapan: null },
  { nama: "GZ_4h",    jenis: "GZ",  tf: "4h", uni: "A", sejak: GZ_HIDUP_LAGI_MS,
    harapan: null },
  { nama: "FIB_1h",   jenis: "FIB", tf: "1h", uni: "A",
    K: 5,  umur: 120, jeda: 12, batas: 60,
    harapan: "+0.2999 wr 49% CI95lo +0.0872 n=166 (irisan 6, PRADAFTAR_fib_dekat_ema.md)" },
  { nama: "FIB_4h",   jenis: "FIB", tf: "4h", uni: "A",
    K: 5,  umur: 120, jeda: 12, batas: 60,
    harapan: "+0.4125 (irisan 7, PRADAFTAR_fib_4h.md)" },
  { nama: "FIB20_1h", jenis: "FIB", tf: "1h", uni: "A",
    K: 20, umur: 480, jeda: 48, batas: 240,
    harapan: "+0.4658 wr 56% CI95lo +0.2282 n=110 (irisan 8, PRADAFTAR_fib_setara_waktu.md)" },
  { nama: "FIB20_4h", jenis: "FIB", tf: "4h", uni: "A",
    K: 20, umur: 480, jeda: 48, batas: 240,
    harapan: null },
];

const ema = (a, n) => { const k = 2/(n+1); let e = null; const o = [];
  for (const v of a) { e = e == null ? v : v*k + e*(1-k); o.push(e); } return o; };

function atrW(h, l, c) { const n = 14, tr = [];
  for (let i = 0; i < c.length; i++) tr.push(i === 0 ? h[i]-l[i]
    : Math.max(h[i]-l[i], Math.abs(h[i]-c[i-1]), Math.abs(l[i]-c[i-1])));
  const o = new Array(c.length).fill(null); if (c.length <= n) return o;
  let a = 0; for (let i = 1; i <= n; i++) a += tr[i]; a /= n; o[n] = a;
  for (let i = n+1; i < c.length; i++) { a = (a*(n-1)+tr[i])/n; o[i] = a; } return o; }

/**
 * Deteksi FIB. Replika PERSIS blok deteksi di fwd_fib.cjs.
 *
 * LETAK SARINGAN EMA200 WAJIB SESUDAH setup dikonsumsi (last diset, setup=null).
 * research/konfirmasi_fib_dekat_ema.cjs baris 79-82 memakainya sebagai PENGGOLONG
 * sesudah isian, bukan gerbang sebelum isian. Kalau ditaruh lebih awal, setup yang
 * ditolak tetap HIDUP dan terisi ulang di bar berikutnya - aturan BERBEDA yang tidak
 * pernah dikonfirmasi, dan sampelnya menggelembung ~57%. Sudah terjadi sekali
 * 2026-08-29 (BICO ditolak 11:00 lalu masuk lagi 16:00, isian yang mustahil).
 */
function cariFIB(bars, e200, atr, V, msBar) {
  const { t, h, l, c } = bars;
  const K = V.K, akhir = c.length - 1, hasil = [];
  const pvH = i => { for (let j=i-K;j<=i+K;j++) if (j!==i && h[j] >= h[i]) return false; return true; };
  const pvL = i => { for (let j=i-K;j<=i+K;j++) if (j!==i && l[j] <= l[i]) return false; return true; };
  let lowT = null, tipe = null, setup = null, last = -1e15;

  for (let i = K; i <= akhir - K; i++) {
    const bi = i + K;
    if (bi > akhir) break;
    if (pvL(i)) { if (tipe !== "L" || lowT == null || l[i] < lowT) lowT = l[i]; tipe = "L"; }
    if (pvH(i) && lowT != null && lowT > 0) {
      const leg = h[i] - lowT;
      if (leg > 0 && leg / lowT * 100 >= FIB_UMUM.minLeg) setup = { atas: h[i], leg, bawah: lowT, lahir: bi };
      tipe = "H";
    }
    if (!setup) continue;
    if (c[bi] < setup.bawah || (bi - setup.lahir) > V.umur) { setup = null; continue; }
    if (!(atr[bi] > 0) || !(e200[bi] > 0) || !(c[bi] > e200[bi])) continue;
    const p = setup.atas - setup.leg * FIB_UMUM.fib;
    if (!(l[bi] <= p && h[bi] >= p)) continue;              // isian jujur
    if (t[bi] - last < V.jeda * msBar) continue;
    last = t[bi];
    const ayunan = setup.leg / setup.bawah * 100, bawah = setup.bawah;
    setup = null;                                           // setup DIKONSUMSI
    const jarakEma = (c[bi] - e200[bi]) / e200[bi] * 100;
    if (FIB_UMUM.maksEma > 0 && jarakEma > FIB_UMUM.maksEma) continue;   // saringan SESUDAH
    hasil.push({ bar: bi, entry: p, atr: atr[bi], ayunan, bawah, jarakEma });
  }
  return hasil;
}

/** Deteksi GZ. Replika cariGZ() di fwd57.cjs, termasuk perataan pivot berselang-seling
 *  [[pine-pivot-tidak-berselang]]. Jeda TIDAK diterapkan di sini - pakai terapkanJeda(). */
function cariGZbar(bars, atr, e200) {
  const { t, o, h, l, c } = bars;
  const K = GZ.pivK, hasil = [];
  const pvH = i => { for (let j=i-K;j<=i+K;j++) if (j!==i && h[j] >= h[i]) return false; return true; };
  const pvL = i => { for (let j=i-K;j<=i+K;j++) if (j!==i && l[j] <= l[i]) return false; return true; };

  let ph0=null, ph1=null, ph2=null, pl1=null, pl2=null, tipe=null;
  let aktif=false, atas=0, bawah=0, entryLvl=0, lahir=0, sudahEntri=false;

  for (let i = K; i < c.length - K; i++) {
    const bi = i + K;
    if (bi >= c.length) break;
    const aH = pvH(i), aL = pvL(i);
    if (aH) { if (tipe === "H") { if (ph2 == null || h[i] > ph2) ph2 = h[i]; }
              else { ph0=ph1; ph1=ph2; ph2=h[i]; tipe="H"; } }
    if (aL) { if (tipe === "L") { if (pl2 == null || l[i] < pl2) pl2 = l[i]; }
              else { pl1=pl2; pl2=l[i]; tipe="L"; } }

    if (aH && ph0!=null && ph1!=null && ph2!=null && pl1!=null && pl2!=null
        && ph2>ph1 && ph1>ph0 && pl2>pl1 && pl2>0) {
      const leg = ph2 - pl2;
      if (leg > 0 && (leg/pl2)*100 >= GZ.minLeg) {
        atas = ph2; bawah = pl2; entryLvl = ph2 - leg*GZ.fibE; lahir = bi; aktif = true;
        sudahEntri = false;
      }
    }
    if (!aktif) continue;
    if (c[bi] < bawah || (bi - lahir) > GZ.umur) { aktif = false; continue; }
    if (sudahEntri || !(atr[bi] > 0)) continue;
    const tol = GZ.tol * atr[bi];
    if (!(l[bi] <= entryLvl + tol && l[bi] >= entryLvl - tol)) continue;
    if ((Math.min(o[bi], c[bi]) - l[bi]) < GZ.ekor * Math.abs(c[bi] - o[bi])) continue;
    hasil.push({ bar: bi, entry: c[bi], atr: atr[bi], ayunan: ((atas-bawah)/bawah)*100,
                 bawah, atas, jarakEma: e200[bi] > 0 ? (c[bi]-e200[bi])/e200[bi]*100 : null });
    sudahEntri = true; aktif = false;
  }
  return hasil;
}

/** Jeda antar-entry, diterapkan berurutan seperti state st.GZ di fwd57.cjs. */
function terapkanJeda(list, t, jedaMs) {
  const out = []; let last = -1e15;
  for (const g of list) { if (t[g.bar] - last < jedaMs) continue; last = t[g.bar]; out.push(g); }
  return out;
}

/** Semua sinyal satu varian pada satu koin, sudah lewat jeda. */
function cariSinyal(V, B) {
  const bars = { t: B.t, o: B.o, h: B.h, l: B.l, c: B.c };
  return V.jenis === "FIB"
    ? cariFIB(bars, B.e200, B.atr, V, MS[V.tf])
    : terapkanJeda(cariGZbar(bars, B.atr, B.e200), B.t, GZ.jeda * MS[V.tf]);
}

/** Parameter exit milik varian: SL dalam ATR, TP dalam R, batas bar model penuh. */
function paramExit(V) {
  return V.jenis === "FIB"
    ? { slAtr: FIB_UMUM.slAtr, tpR: FIB_UMUM.tpR, batas: V.batas }
    : { slAtr: GZ.sl,          tpR: GZ.tp,        batas: GZ.batas };
}

function ringkasAturan(V) {
  if (V.jenis === "GZ")
    return { fib: GZ.fibE, K: GZ.pivK, tol_atr: GZ.tol, ekor_x_badan: GZ.ekor,
             umur_setup: GZ.umur, jeda_bar: GZ.jeda, sl_atr: GZ.sl, tp_R: GZ.tp,
             batas_bar: "Infinity", tf: V.tf, universe: V.uni };
  return { fib: FIB_UMUM.fib, K: V.K, ayunan_min_pct: FIB_UMUM.minLeg,
           saringan_ema200_pct: FIB_UMUM.maksEma, umur_setup: V.umur, jeda_bar: V.jeda,
           sl_atr: FIB_UMUM.slAtr, tp_R: FIB_UMUM.tpR, batas_bar: V.batas,
           tf: V.tf, universe: V.uni };
}

module.exports = { JAM, MS, BIAYA, FIB_UMUM, GZ, VARIAN, GZ_HIDUP_LAGI_MS,
                   ema, atrW, cariFIB, cariGZbar, terapkanJeda,
                   cariSinyal, paramExit, ringkasAturan };
