/**
 * BANDING TF (2026-09-26, permintaan user: "taruh di riwayat dan jurnal semua sinyal pola 1H, 4H, 1D sebagai perbandingan").
 * INFORMASI SAJA: 1H dan 1D tidak masuk bot, tidak ada alert. Dijalankan GitHub Actions sekali sehari (banding.yml).
 *
 * Aturan pola SAMA dengan aplikasi & Telegram: modul pola_dc_peristiwa.cjs (satu sumber), ambang DC 3.5 untuk 1H,
 * 2.5 untuk >= 2H (sama dengan Pine), Elliott ikut. Exit sama dengan simTrade() aplikasi: 50% di TP1, SL sisa ke entry,
 * sisa TP2 (ST, AT) atau trailing 15% (FW, TB, EW). Modal simulasi 1000 USDT, biaya 0.2% bolak-balik.
 * Jendela: sinyal yang VALID dalam 100 hari terakhir, semua TF sama, supaya adil dibandingkan.
 *
 * Keluaran: banding_tf.json di akar repo (dibaca aplikasi). Uji lokal: DRY=1 KOIN_UJI=BTC,ETH,SOL node notif/banding_tf.cjs
 */
const fs = require("fs"), path = require("path");
const { peristiwa } = require("./pola_dc_peristiwa.cjs");
const U = require("./universe_gabungan.json");
const DRY = process.env.DRY === "1";
const KOIN = (process.env.KOIN_UJI ? process.env.KOIN_UJI.split(",") : (U.koin || U)).map(s => String(s).trim().toUpperCase()).filter(Boolean);
const HOSTS = ["https://data-api.binance.vision", "https://api.binance.com", "https://api-gcp.binance.com"];
const SEMBUNYI = new Set(["DB", "RC", "BF", "CH", "IHS", "PEN"]);          // sama dengan bawaan chart & aplikasi
const NOMINAL = 1000, BIAYA = 0.002, HARI = 100, JENDELA = HARI * 864e5;
// per TF: ambang DC (mx), lama lilin, jumlah lilin diambil (jendela 100 hari + pemanasan)
const TF = { "1h": { mx: 3.5, bar: 3600e3, ambil: 3000 }, "4h": { mx: 2.5, bar: 4 * 3600e3, ambil: 800 }, "1d": { mx: 2.5, bar: 864e5, ambil: 500 } };
const TP_A = { FW: [1.5, null], ST: [1.5, 2], AT: [1, null], TB: [1.5, 3], EW: [0.5, null] };
const TRAIL_K = new Set(["FW", "TB", "EW"]), TRAIL_P = 0.15;
const F_OUT = path.join(__dirname, "..", "banding_tf.json");

async function getJ(p) {
  for (const h of HOSTS) {
    for (let coba = 0; coba < 2; coba++) {
      try { const r = await fetch(h + p); if (r.ok) return await r.json(); if (r.status === 400) return null; if (r.status === 429 || r.status === 418) await tidur(3000); } catch (e) {}
    }
  }
  return null;
}
const tidur = ms => new Promise(r => setTimeout(r, ms));
const atrArr = (h, l, c, n = 14) => {
  const o = new Array(c.length).fill(null); if (c.length <= n) return o;
  const tr = i => Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  let a = 0; for (let i = 1; i <= n; i++) a += tr(i); a /= n; o[n] = a;
  for (let i = n + 1; i < c.length; i++) { a = (a * (n - 1) + tr(i)) / n; o[i] = a; }
  return o;
};
function tpAturan(kode, entry, sl, tpBuku) {
  const [a, t] = TP_A[kode] || [0.75, null], tp2 = t ? entry + t * (entry - sl) : tpBuku;
  let tp1 = entry + a * (entry - sl); if (tp1 >= tp2) tp1 = entry + 0.5 * (tp2 - entry);
  return { tp1, tp2 };
}
function level(d, e) {
  const entry = e.entry != null ? e.entry : d.c[e.i], sl = e.batal, tpB = e.level + e.tinggi;
  if (!(entry > sl) || !(tpB > entry)) return null;
  const { tp1, tp2 } = tpAturan(e.kode, entry, sl, tpB);
  return { entry, sl, tp1, tp2, trailP: TRAIL_K.has(e.kode) ? TRAIL_P : 0 };
}
// sama dengan simTrade() aplikasi / simTahap() notif_pola.cjs
function sim(d, i, L) {
  const n = d.c.length; let st = "jalan", kenaTp1 = false, sisa = 1, real = 0, keluarT = null, puncak = 0;
  const trail = L.trailP > 0, tutup = (w, px) => { real += w * NOMINAL * (px / L.entry - 1); sisa -= w; };
  for (let k = i + 1; k < n && st === "jalan"; k++) {
    if (!kenaTp1) {
      if (d.l[k] <= L.sl) { tutup(1, L.sl); st = "SL"; keluarT = d.t[k]; }
      else if (d.h[k] >= L.tp1) { tutup(0.5, L.tp1); kenaTp1 = true; puncak = Math.max(L.tp1, d.h[k]); if (!trail && d.h[k] >= L.tp2) { tutup(sisa, L.tp2); st = "TP2"; keluarT = d.t[k]; } }
    } else if (trail) {
      const stop = Math.max(L.entry, puncak * (1 - L.trailP));
      if (d.l[k] <= stop) { tutup(sisa, stop); st = stop > L.entry * 1.0005 ? "TP2" : "BE"; keluarT = d.t[k]; } else if (d.h[k] > puncak) puncak = d.h[k];
    } else if (d.l[k] <= L.entry) { tutup(sisa, L.entry); st = "BE"; keluarT = d.t[k]; }
    else if (d.h[k] >= L.tp2) { tutup(sisa, L.tp2); st = "TP2"; keluarT = d.t[k]; }
  }
  if (Math.abs(sisa) < 1e-9) sisa = 0;
  const px = d.c[n - 1], usdt = real + sisa * NOMINAL * (px / L.entry - 1) - NOMINAL * BIAYA;   // posisi jalan dinilai di close terakhir
  return { st, kenaTp1, keluarT, sisa, usdt: +usdt.toFixed(2) };
}
async function lilin(k, tf) {
  const T = TF[tf]; let semua = [], end = null;
  while (semua.length < T.ambil) {
    const j = await getJ(`/api/v3/klines?symbol=${k}USDT&interval=${tf}&limit=1000${end ? "&endTime=" + end : ""}`);
    if (!Array.isArray(j) || !j.length) break;
    semua = j.concat(semua); end = +j[0][0] - 1; if (j.length < 1000) break;
  }
  const skr = Date.now(), b = semua.filter(x => +x[6] < skr);
  if (b.length < 150 || skr - +b[b.length - 1][6] > 3 * T.bar) return null;   // basi / delisting / terlalu pendek
  return { t: b.map(x => +x[0]), o: b.map(x => +x[1]), h: b.map(x => +x[2]), l: b.map(x => +x[3]), c: b.map(x => +x[4]), v: b.map(x => +x[5]) };
}
async function hitungKoin(k, tf, out) {
  const d = await lilin(k, tf); if (!d) return false;
  let ev; try { ev = peristiwa(d, atrArr(d.h, d.l, d.c), { elliott: true, mx: TF[tf].mx }) || []; } catch (e) { return false; }
  const batas = Date.now() - JENDELA;
  for (const e of ev) {
    if (SEMBUNYI.has(e.kode) || d.t[e.i] < batas) continue;
    const L = level(d, e); if (!L) continue;
    const r = sim(d, e.i, L), risiko = NOMINAL * (1 - L.sl / L.entry);
    out.push({ k, kode: e.kode, masukT: d.t[e.i], keluarT: r.keluarT, st: r.st, usdt: r.usdt, R: risiko > 0 ? +(r.usdt / risiko).toFixed(2) : null, entry: L.entry, sl: L.sl, tp1: L.tp1, tp2: L.tp2, kenaTp1: r.kenaTp1 });
  }
  return true;
}
function ringkas(trades) {
  const tutup = trades.filter(t => t.st !== "jalan"), jalan = trades.filter(t => t.st === "jalan");
  const agg = a => { const n = a.length, m = a.filter(t => t.usdt > 0).length, tot = a.reduce((x, t) => x + t.usdt, 0), Rs = a.filter(t => t.R != null);
    return { n, m, wr: n ? +(m / n * 100).toFixed(1) : null, tot: +tot.toFixed(2), rata: n ? +(tot / n).toFixed(2) : null, rR: Rs.length ? +(Rs.reduce((x, t) => x + t.R, 0) / Rs.length).toFixed(3) : null,
      tp2: a.filter(t => t.st === "TP2").length, be: a.filter(t => t.st === "BE").length, sl: a.filter(t => t.st === "SL").length }; };
  const per = {}; for (const t of tutup) (per[t.kode] = per[t.kode] || []).push(t);
  const perPola = {}; for (const [kd, a] of Object.entries(per)) perPola[kd] = { ...agg(a), jalan: jalan.filter(t => t.kode === kd).length };
  const kurva = tutup.slice().sort((a, b) => a.keluarT - b.keluarT); let kum = 0;
  return { ...agg(tutup), jalan: jalan.length, jalanUsdt: +jalan.reduce((x, t) => x + t.usdt, 0).toFixed(2), perPola, kurva: kurva.map(t => [t.keluarT, +(kum += t.usdt).toFixed(2)]) };
}
(async () => {
  const t0 = Date.now(), hasil = {}, dicek = {};
  for (const tf of Object.keys(TF)) { hasil[tf] = []; dicek[tf] = 0; }
  let i = 0; const kerja = async () => { while (i < KOIN.length) { const k = KOIN[i++]; for (const tf of Object.keys(TF)) { if (await hitungKoin(k, tf, hasil[tf])) dicek[tf]++; await tidur(120); } if (i % 20 === 0) console.log(`${i}/${KOIN.length} koin · ${Math.round((Date.now() - t0) / 1000)} dtk`); } };
  await Promise.all(Array.from({ length: 3 }, kerja));
  const out = { t: Date.now(), hari: HARI, nominal: NOMINAL, biaya: BIAYA, koin: KOIN.length, dicek, tf: {} };
  for (const tf of Object.keys(TF)) {
    const tr = hasil[tf].sort((a, b) => b.masukT - a.masukT);
    out.tf[tf] = { ...ringkas(tr), trade: tr.slice(0, 400) };   // daftar: 400 terbaru saja supaya berkas kecil; ringkasan dari SEMUA
    const R = out.tf[tf]; console.log(`${tf.padEnd(3)} koin ${dicek[tf]} · tutup ${R.n} · WR ${R.wr}% · rata ${R.rata} · total ${R.tot} · jalan ${R.jalan} (${R.jalanUsdt})`);
    for (const [kd, p] of Object.entries(R.perPola)) console.log(`     ${kd} n=${p.n} WR ${p.wr}% rata ${p.rata} tot ${p.tot} R ${p.rR}`);
  }
  if (DRY) { fs.writeFileSync(F_OUT.replace(/\.json$/, "_uji.json"), JSON.stringify(out)); console.log("DRY: ditulis banding_tf_uji.json (" + Math.round(JSON.stringify(out).length / 1024) + " KB)"); return; }
  fs.writeFileSync(F_OUT, JSON.stringify(out));
  console.log(`ditulis banding_tf.json (${Math.round(JSON.stringify(out).length / 1024)} KB) · ${Math.round((Date.now() - t0) / 1000)} dtk`);
})().catch(e => { console.error("GAGAL", e); process.exit(1); });
