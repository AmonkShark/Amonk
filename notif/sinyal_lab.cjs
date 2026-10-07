/**
 * SINYAL LAB L030 / L027 untuk Telegram (2026-10-06, user: "sinkronkan data dengan github, telegram dan terminal").
 * SALINAN PERSIS dari terminal/amonk_terminal.html (fungsi emaArr, atrArr, sinyalLab, simLab) — kalau aturan diubah di aplikasi, salin ulang ke sini.
 * Rumus = research/lab_aturan/L030.cjs & L027.cjs; exit = gaya bot (50% di 1.5R, trailing 15%, 120 lilin, biaya 0.2%). BELUM TERBUKTI, bukan sinyal bot.
 */
const window = { PolaDC: require("./pola_dc_peristiwa.cjs") };
const BIAYA_POLA = 0.002;
const KODE_POLA = { FW: "Falling Wedge", ST: "Symmetrical Triangle", AT: "Ascending Triangle", TB: "Triple Bottom", EW: "Elliott Wave" };
function emaArr(c, n) {
  const o = new Array(c.length).fill(null); if (c.length < n) return o;
  const k = 2 / (n + 1); let e = 0; for (let i = 0; i < n; i++) e += c[i]; e /= n; o[n - 1] = e;
  for (let i = n; i < c.length; i++) { e = c[i] * k + e * (1 - k); o[i] = e; }
  return o;
}
function atrArr(h, l, c, n = 14) {
  const o = new Array(c.length).fill(null);
  if (c.length <= n) return o;
  const tr = i => Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  let a = 0; for (let i = 1; i <= n; i++) a += tr(i); a /= n; o[n] = a;
  for (let i = n + 1; i < c.length; i++) { a = (a * (n - 1) + tr(i)) / n; o[i] = a; }
  return o;
}
const LAB_KODE = ["L030", "L027"];   // 2026-10-06 (user sesudah melihat Riwayat): hanya L030 & L027 yang dipakai; L029 tetap dihitung di dalam L030
const LAB_POLA = new Set(["TB", "FW"]);
const LAB_NAMA = { L029: "L029 AO + Stoch", L030: "L030 AO + Stoch di setup pola", L027: "L027 Inside bar + kapitulasi" };
function smaLab(x, n) { const o = new Array(x.length).fill(null); let s = 0, c = 0; for (let i = 0; i < x.length; i++) { if (x[i] == null) { s = 0; c = 0; continue; } s += x[i]; c++; if (c > n) s -= x[i - n]; if (c >= n) o[i] = s / n; } return o; }
function rsiLab(c, n = 14) { const o = new Array(c.length).fill(null); let g = 0, l = 0; for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1], u = Math.max(d, 0), v = Math.max(-d, 0); if (i <= n) { g += u / n; l += v / n; if (i === n) o[i] = l ? 100 - 100 / (1 + g / l) : 100; } else { g = (g * (n - 1) + u) / n; l = (l * (n - 1) + v) / n; o[i] = l ? 100 - 100 / (1 + g / l) : 100; } } return o; }
function simLab(d, i, sl, kode, pola) {
  const n = d.c.length, e = d.c[i], R1 = e - sl, kom = BIAYA_POLA * e / R1, tp1 = e + 1.5 * R1, j = i + 1;
  let kena = false, pk = e;
  const dasar = { kode, nama: LAB_NAMA[kode], pola, masukT: d.t[i], umur: n - 1 - i, entry: e, sl, tp1, kom };
  const tutup = (px, m, sebab) => ({ ...dasar, st: "tutup", kenaTp1: kena, keluarT: d.t[m], keluarPx: px, m, sebab, R: (kena ? 0.75 + 0.5 * (px - e) / R1 : (px - e) / R1) - kom });
  for (let m = j; m < Math.min(n, j + 120); m++) {
    const st = kena ? Math.max(sl, pk * 0.85) : sl;
    if (d.o[m] <= st) return tutup(d.o[m], m, kena ? "TP1 + trailing (celah)" : "SL (celah)");
    if (d.l[m] <= st) return tutup(st, m, kena ? (st > e ? "TP1 + trailing" : "TP1 + kembali ke SL") : "SL");
    if (!kena && d.h[m] >= tp1) kena = true;
    pk = Math.max(pk, d.h[m]);
  }
  if (j + 119 < n) return tutup(d.c[j + 119], j + 119, "batas waktu");
  return { ...dasar, st: "jalan", kenaTp1: kena, stop: kena ? Math.max(sl, pk * 0.85) : sl, sisaBar: j + 119 - (n - 1), m: null };
}
function sinyalLab(d, mx) {
  const n = d.c.length, A = atrArr(d.h, d.l, d.c), out = {};
  // saringan semesta sama dengan Lab: aset yang tidak bergerak (median ATR14/close < 0.2%, mis. stablecoin) dilewati
  { const x = []; for (let i = 20; i < n; i++) if (A[i]) x.push(A[i] / d.c[i]); x.sort((a, b) => a - b); if (!x.length || x[x.length >> 1] < 0.002) return out; }
  const hl2 = d.h.map((h, i) => (h + d.l[i]) / 2), s5 = smaLab(hl2, 5), s34 = smaLab(hl2, 34);
  const ao = s5.map((v, i) => v != null && s34[i] != null ? v - s34[i] : null);
  const k0 = d.c.map((c, i) => { if (i < 13) return null; let H = -Infinity, L = Infinity; for (let q = i - 13; q <= i; q++) { H = Math.max(H, d.h[q]); L = Math.min(L, d.l[q]); } return H > L ? 100 * (c - L) / (H - L) : 50; });
  const K = smaLab(k0, 3), D = smaLab(K, 3), RS = rsiLab(d.c, 14), VE = emaArr(d.v, 20);
  let akt = null; try { akt = window.PolaDC.peristiwa(d, A, { mx: mx > 0 ? mx : 2.5, aktifPerBar: true }).aktif || null; } catch (e) { akt = null; }
  const l29 = i => ao[i] != null && ao[i - 1] != null && ao[i] > 0 && ao[i - 1] <= 0 && K[i] != null && D[i] != null && K[i] > D[i] && K[i] < 80;
  const polaDi = i => akt ? [...new Set((akt[i] || []).filter(k => LAB_POLA.has(k)))] : [];
  const SIG = { L029: l29, L030: i => l29(i) && polaDi(i).length > 0,
    L027: i => d.h[i - 1] < d.h[i - 2] && d.l[i - 1] > d.l[i - 2] && d.c[i] > d.h[i - 1] && RS[i] != null && RS[i] < 35 && VE[i] && d.v[i] >= 1.5 * VE[i] };
  for (const kode of LAB_KODE) {
    const T = []; let bebas = 210;
    for (let i = 210; i < n; i++) {
      if (i < bebas || !A[i] || !SIG[kode](i)) continue;
      let lo = Infinity; for (let q = i - 4; q <= i; q++) lo = Math.min(lo, d.l[q]);
      const sl = lo - 0.5 * A[i]; if (!(d.c[i] > sl)) continue;
      const t = simLab(d, i, sl, kode, kode === "L030" ? polaDi(i).map(k => KODE_POLA[k] || k).join(" + ") : "");
      T.push(t); bebas = t.m == null ? Infinity : t.m + 1;
    }
    out[kode] = T;
  }
  return out;
}
// CALON L027 / L030 (2026-10-07, user: "tanda-tanda sebelum dikatakan valid ... meninjau lebih awal"). Dinilai di lilin 4H TUTUP terakhir.
// HANYA PANTAUAN: bot tetap masuk saat sinyal VALID (masuk lebih awal belum diuji). Rumus syarat sama dengan sinyalLab().
//   L027: lilin terakhir INSIDE BAR & RSI14 < 35 (lilin pemicu tutup naik -> RSI-nya lebih tinggi, jadi < 35 tidak membuang sinyal) -> valid bila lilin berikut TUTUP > high inside bar, RSI14 < 35, volume >= 1.5 x EMA20 volume
//   L030: setup TB/FW hidup & AO masih <= 0 & level pemicu <= 5% di atas close -> valid bila AO menyeberang 0 (butuh (H+L)/2 lilin berikut >= level) + Stoch %K > %D & %K < 80
// SL perkiraan = low 4 lilin terakhir - 0.5 ATR (yang sebenarnya dihitung ulang di lilin sinyal).
function calonLab(d, mx) {
  const n = d.c.length, i = n - 1, out = []; if (n < 60) return out;
  const A = atrArr(d.h, d.l, d.c);
  { const x = []; for (let q = 20; q < n; q++) if (A[q]) x.push(A[q] / d.c[q]); x.sort((a, b) => a - b); if (!x.length || x[x.length >> 1] < 0.002) return out; }
  const hl2 = d.h.map((h, q) => (h + d.l[q]) / 2), s5 = smaLab(hl2, 5), s34 = smaLab(hl2, 34);
  const ao = s5.map((v, q) => v != null && s34[q] != null ? v - s34[q] : null);
  const k0 = d.c.map((c, q) => { if (q < 13) return null; let H = -Infinity, L = Infinity; for (let z = q - 13; z <= q; z++) { H = Math.max(H, d.h[z]); L = Math.min(L, d.l[z]); } return H > L ? 100 * (c - L) / (H - L) : 50; });
  const K = smaLab(k0, 3), D = smaLab(K, 3), RS = rsiLab(d.c, 14), VE = emaArr(d.v, 20);
  let lo = Infinity; for (let q = i - 3; q <= i; q++) lo = Math.min(lo, d.l[q]);
  const sl = A[i] ? lo - 0.5 * A[i] : null;
  if (d.h[i] < d.h[i - 1] && d.l[i] > d.l[i - 1] && RS[i] != null && RS[i] < 35 && sl > 0)
    out.push({ kode: "L027", nama: "Calon L027", level: d.h[i], sl, ket: "inside bar · RSI " + RS[i].toFixed(0) + (VE[i] ? " · butuh volume ≥ " + (1.5 * VE[i]).toPrecision(3) : ""), t: d.t[i] });
  let akt = null; try { akt = window.PolaDC.peristiwa(d, A, { mx: mx > 0 ? mx : 2.5, aktifPerBar: true }).aktif || null; } catch (e) { akt = null; }
  const pola = akt ? [...new Set((akt[i] || []).filter(k => LAB_POLA.has(k)))] : [];
  if (pola.length && ao[i] != null && ao[i] <= 0 && sl > 0) {
    let s4 = 0, s33 = 0; for (let q = i - 3; q <= i; q++) s4 += hl2[q]; for (let q = i - 32; q <= i; q++) s33 += hl2[q];
    const level = (s33 / 34 - s4 / 5) / (1 / 5 - 1 / 34);
    if (level > 0 && level <= d.c[i] * 1.05) out.push({ kode: "L030", nama: "Calon L030 (setup " + pola.map(k => KODE_POLA[k] || k).join(" + ") + ")", level, sl,
      ket: "AO " + (ao[i] / d.c[i] * 100).toFixed(2) + "% " + (ao[i] > ao[i - 1] ? "naik" : "turun") + " ke 0 · Stoch " + (K[i] != null && D[i] != null ? (K[i] > D[i] ? "%K>%D ✓" : "%K<%D") : "—"), t: d.t[i] });
  }
  return out;
}
// trade Lab dalam bentuk Riwayat (sama dengan simTrade): real = USDT yang sudah terealisasi dari 1000, sisa = bagian posisi yang masih jalan
function labKeRw(t) {
  const N = MODAL_POLA, e = t.entry, r1 = t.kenaTp1 ? 0.5 * N * (t.tp1 / e - 1) : 0;
  if (t.st === "jalan") return { nama: t.nama, kode: t.kode, masukT: t.masukT, keluarT: null, entry: e, sl: t.sl, tp1: t.tp1, tp2: null, st: "jalan", kenaTp1: t.kenaTp1, sisa: t.kenaTp1 ? 0.5 : 1, real: r1, keluarPx: null };
  const px = t.keluarPx, real = t.kenaTp1 ? r1 + 0.5 * N * (px / e - 1) : N * (px / e - 1);
  const st = t.kenaTp1 ? (px > e * 1.0005 ? "TP2" : "BE") : t.sebab === "batas waktu" ? "WAKTU" : "SL";
  return { nama: t.nama, kode: t.kode, masukT: t.masukT, keluarT: t.keluarT, entry: e, sl: t.sl, tp1: t.tp1, tp2: null, st, kenaTp1: t.kenaTp1, sisa: 0, real, keluarPx: px };
}

module.exports = { sinyalLab, calonLab, LAB_KODE, LAB_NAMA };
