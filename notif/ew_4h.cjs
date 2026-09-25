/**
 * ELLIOTT WAVE 4H untuk BOT (2026-09-23, permintaan user: centang "Elliott Wave" di pengaturan bot,
 * "samakan dengan sinyal pola lainnya"). Dijalankan GitHub Actions tiap jam (langkah kedua di
 * .github/workflows/fib.yml), TANPA alert TradingView.
 *
 * Aturan = elliott() di pola_dc_peristiwa.cjs — modul yang SAMA dengan aplikasi, Telegram, rutin, dan
 * replika blok ELLIOTT (ew*) di AMONK SINYAL - LOGIKA/GARIS. Yang dikirim ke bot hanya limit yang
 * MASIH MENUNGGU (setup hidup, belum tersentuh, belum kedaluwarsa):
 *   p = harga limit (kedalaman 0.90 gelombang 3), sl = p − 2.5 ATR (ATR lilin 4H tutup terakhir),
 *   tp2 = entry + 3R; TP1 = 0.5R (50%) — pilihan user 2026-09-24, SL naik ke entry sesudah TP1.
 * Koin yang gagal diambil ikut disebut (`gagal`) supaya bot TIDAK membatalkan ordernya karena data bolong.
 * Rahasia GitHub: BOT_URL, BOT_KUNCI (sama dengan FIB). DRY=1 atau tanpa BOT_URL: hanya mencetak.
 */
const { elliott, EW, peristiwa } = require("./pola_dc_peristiwa.cjs");
const U = require("./universe_gabungan.json");
const KOIN = (U.koin || U).map(s => String(s).toUpperCase());
const BOT_URL = (process.env.BOT_URL || "").replace(/\/+$/, ""), BOT_KUNCI = process.env.BOT_KUNCI || "";
const DRY = process.env.DRY === "1" || !BOT_URL || !BOT_KUNCI;
const HOSTS = ["https://data-api.binance.vision", "https://api.binance.com", "https://api-gcp.binance.com"];
const BAR = 4 * 3600e3, MX_4H = 2.5;                  // ambang DC 4H (Pine: >=2H -> 2.5, kedalaman 0.90)
async function getJ(p) { for (const h of HOSTS) { try { const r = await fetch(h + p); if (r.ok) return r.json(); if (r.status === 400) return null; } catch (e) {} } return null; }
// ATR Wilder, sama persis dengan atrArr di notif_pola.cjs / aplikasi
const atrArr = (h, l, c, n = 14) => {
  const o = new Array(c.length).fill(null); if (c.length <= n) return o;
  const tr = i => Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  let a = 0; for (let i = 1; i <= n; i++) a += tr(i); a /= n; o[n] = a;
  for (let i = n + 1; i < c.length; i++) { a = (a * (n - 1) + tr(i)) / n; o[i] = a; }
  return o;
};

// PEMINDAI TELEGRAM (2026-09-25): selain limit Elliott, hitung koin MENUJU pola valid (SETUP/CALON) dan pola BARU valid, dikirim ke bot supaya
// tombol/perintah Telegram (/menuju, /baru) bisa menjawab sekali klik. Kode pola & aturan TP sama dengan aplikasi.
const TP_A = { FW: [1.5, null], ST: [1.5, 2], AT: [1, null], TB: [1.5, 3] };
const KODE_OK = new Set(Object.keys(TP_A));
(async () => {
  const sekarang = Date.now(), koin = [], gagal = [], menuju = [], baru = [];
  let dicek = 0;
  for (const k of KOIN) {
    const j = await getJ(`/api/v3/klines?symbol=${k}USDT&interval=4h&limit=600`);
    if (!Array.isArray(j)) { gagal.push(k + "USDT"); continue; }
    const b = j.filter(x => +x[6] < sekarang);                                  // buang lilin berjalan
    if (b.length < 200 || sekarang - +b[b.length - 1][6] > 3 * BAR) continue;   // koin baru / basi / delisting
    const d = { t: b.map(x => +x[0]), o: b.map(x => +x[1]), h: b.map(x => +x[2]), l: b.map(x => +x[3]), c: b.map(x => +x[4]) };
    const A = atrArr(d.h, d.l, d.c);
    dicek++;
    try {   // menuju valid & baru valid (tidak boleh menjatuhkan alur Elliott bila gagal)
      const ev = peristiwa(d, A, { setupAkhir: true, calonAkhir: true }) || [], nn = d.c.length, hg = d.c[nn - 1];
      for (const st of (ev.setup || [])) if (KODE_OK.has(st.kode) && st.level > 0 && st.batal > 0 && hg > st.batal && st.level / hg - 1 <= 0.15)
        menuju.push({ sym: k + "USDT", jenis: "SETUP", nama: st.nama, kode: st.kode, level: st.level, batal: st.batal, tinggi: st.tinggi || 0, umur: st.umur, sisa: st.sisa });
      for (const st of (ev.calon || [])) if (KODE_OK.has(st.kode) && st.level > 0 && st.batal > 0 && hg > st.batal && st.level / hg - 1 <= 0.15)
        menuju.push({ sym: k + "USDT", jenis: "CALON", nama: st.nama, kode: st.kode, level: st.level, batal: st.batal, tinggi: st.tinggi || 0, sahP: st.sahP });
      for (const e of ev) { if (!KODE_OK.has(e.kode) || nn - 1 - e.i > 6) continue;
        const E = d.c[e.i], sl = e.batal, R = E - sl; if (!(R > 0) || !(sl > 0)) continue;
        const [a1, t2] = TP_A[e.kode], tpBuku = e.level + e.tinggi, tp2 = t2 ? E + t2 * R : tpBuku; let tp1 = E + a1 * R; if (tp1 >= tp2) tp1 = E + 0.5 * (tp2 - E);
        let mati = false; for (let q = e.i + 1; q < nn; q++) { if (d.l[q] <= sl || d.h[q] >= tp1) { mati = true; break; } }
        if (!mati) baru.push({ sym: k + "USDT", nama: e.nama, kode: e.kode, umur: nn - 1 - e.i, entry: E, sl, tp1, tp2 }); }
    } catch (e) { /* abaikan */ }
    let S; try { S = elliott(d, A, MX_4H).setup; } catch (e) { gagal.push(k + "USDT"); continue; }
    if (!S) continue;
    const n = d.c.length, atr = A[n - 1];
    if (!(atr > 0) || !(S.level > 0)) continue;
    // likuiditas 7 hari (42 lilin 4H) di pasar ASLI — urutan pilih sama dengan FIB (keputusan user, bukan edge)
    const likuid = Math.round(b.slice(-42).reduce((s, x) => s + +x[7], 0));
    koin.push({ sym: k + "USDT", likuid, harga: d.c[n - 1], setup: {
      p: S.level, sl: S.level - EW.slAtr * atr, tp2: S.level + S.tinggi, atr,
      lahirT: d.t[S.lahirB], sisa: S.sisa, ayun: +S.ayun.toFixed(1) } });
  }
  const isi = { t: sekarang, u: KOIN.map(k => k + "USDT"), menuju, baru, aturan: { kedalaman: 0.9, slAtr: EW.slAtr, ayunMin: EW.ayun, gel1Min: EW.gel1Min, tunggu: EW.tunggu, tp1R: 0.5, tp2R: 3 }, dicek, gagal, koin };
  if (dicek < KOIN.length * 0.5) { console.log(`ELLIOTT: hanya ${dicek}/${KOIN.length} koin terbaca — TIDAK dikirim (bot memakai data lama sampai basi)`); process.exitCode = 1; return; }
  if (DRY) {
    console.log(`DRY: ${dicek} koin dicek, ${gagal.length} gagal, ${koin.length} limit ELLIOTT hidup, ${menuju.length} menuju valid, ${baru.length} baru valid`);
    for (const x of menuju.slice(0, 8)) console.log('menuju', JSON.stringify(x)); for (const x of baru.slice(0, 5)) console.log('baru', JSON.stringify(x));
    for (const x of koin) console.log(JSON.stringify({ sym: x.sym, harga: x.harga, likuid: x.likuid, ...x.setup }));
    return;
  }
  const r = await fetch(`${BOT_URL}/ew?k=${encodeURIComponent(BOT_KUNCI)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isi) });
  console.log(`ELLIOTT 4H: ${dicek} koin dicek, ${koin.length} limit hidup, kirim ke bot: HTTP ${r.status} ${(await r.text()).slice(0, 80)}`);
  if (!r.ok) process.exitCode = 1;
})();
