/**
 * DAFTAR KOIN BER-MONITORING TAG BINANCE (2026-10-04, keputusan user "ya kerjakan keduanya").
 * Dasar: research/uji_monitoring_tag.cjs (PRADAFTAR_monitoring_tag_stablecoin.md) — 138 koin ber-tag 2023-10..2026-09:
 * 30 hari sesudah tag −6.4% rata / −14% median vs koin acak tanggal sama (p 0.000, dua periode searah), 64% lalu delist (median 57 hari).
 * Dipakai bot (worker) sebagai saringan "lewati koin ber-tag". Saringan KERUGIAN, bukan pencipta untung.
 *
 * Sumber: judul pengumuman CMS publik Binance — katalog 49 (Latest Binance News, sampai 2023-07) dan 161 (Delisting, semua).
 *   tag   : "Binance Will Extend the Monitoring Tag to (Include) A, B & C ..."
 *   lepas : "... Remove the Monitoring Tag for X ..."
 *   delist: "Binance Will Delist A, B on YYYY-MM-DD" (spot; futures/margin/pair diabaikan)
 * Aktif = tag terbaru koin itu belum dilepas dan belum diumumkan delist sesudahnya. Koin yang diumumkan delist juga dimasukkan
 * ke daftar "delist" (bot tidak boleh membeli koin yang akan dihapus).
 * Batas: koin pada pengumuman pengantar 2023-07-26 tidak tercantum di judul -> tidak terdeteksi (hampir semuanya sudah delist).
 * Gagal mengambil data -> berkas lama TIDAK ditimpa (kode keluar 0, pesan di log).
 * Pakai: node notif/monitoring_tag.cjs   -> notif/monitoring_tag.json
 */
const fs = require("fs"), path = require("path");
const F = path.join(__dirname, "monitoring_tag.json"), BATAS = Date.UTC(2023, 6, 1);
const tidur = ms => new Promise(r => setTimeout(r, ms));
async function halaman(kat, hal) {
  for (let c = 0; c < 3; c++) {
    try { const r = await fetch(`https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&catalogId=${kat}&pageNo=${hal}&pageSize=50`, { headers: { "User-Agent": "Mozilla/5.0 (amonk-monitoring-tag)" }, signal: AbortSignal.timeout(20000) });
      if (r.ok) { const j = await r.json(); return (j.data && j.data.catalogs && j.data.catalogs[0] && j.data.catalogs[0].articles) || []; }
      console.log(`katalog ${kat} hal ${hal}: HTTP ${r.status}`); } catch (e) { console.log(`katalog ${kat} hal ${hal}: ${e.message}`); }
    await tidur(2000 * (c + 1));
  }
  return null;
}
const pisah = s => s.replace(/ on \d{4}-\d\d-\d\d.*$/, "").split(/,|&| and /).map(x => x.trim().toUpperCase()).filter(x => /^[A-Z0-9]{2,12}$/.test(x));
(async () => {
  const A = [];
  for (const kat of [49, 161]) {
    for (let hal = 1; hal <= 120; hal++) {
      const x = await halaman(kat, hal);
      if (x === null) { console.log(`GAGAL mengambil katalog ${kat} — ${F} tidak diubah`); process.exit(0); }
      if (!x.length) break;
      for (const a of x) A.push({ judul: a.title, t: a.releaseDate });
      if (kat === 49 && x[x.length - 1].releaseDate < BATAS) break;
      await tidur(300);
    }
  }
  const tag = [], lepas = [], delist = [];
  for (const { judul: j, t } of A) {
    const m = j.match(/Extend the Monitoring Tag to (?:Include )?(.+?)(?:,? and Remove|, Remove| on \d{4}-|$)/i); if (m) for (const k of pisah(m[1])) tag.push({ k, t });
    const r = j.match(/Remove the Monitoring Tag for (.+?)(?:,? and Remove|, and| on \d{4}-|$)/i); if (r) for (const k of pisah(r[1])) lepas.push({ k, t });
    const d = j.match(/^Binance Will Delist (.+?) on \d{4}-\d\d-\d\d/i); if (d && !/futures|margin|perpetual|convert|pair/i.test(j)) for (const k of pisah(d[1])) delist.push({ k, t });
  }
  if (tag.length < 50) { console.log(`HANYA ${tag.length} peristiwa tag terbaca (harusnya > 100) — data diragukan, ${F} tidak diubah`); process.exit(0); }
  const aktif = {};
  for (const k of new Set(tag.map(x => x.k))) {
    const tt = Math.max(...tag.filter(x => x.k === k).map(x => x.t));
    if (lepas.some(l => l.k === k && l.t > tt)) continue;
    if (delist.some(d => d.k === k && d.t > tt)) continue;
    aktif[k] = { sejak: new Date(tt).toISOString().slice(0, 10) };
  }
  const umumDelist = {}; const SETAHUN = Date.now() - 365 * 864e5;
  for (const d of delist) if (d.t > SETAHUN) umumDelist[d.k] = new Date(d.t).toISOString().slice(0, 10);
  const out = { dibuat: new Date().toISOString(), sumber: "judul pengumuman CMS Binance (katalog 49 & 161)", jumlahPengumuman: A.length,
    aktif, delist: umumDelist, catatan: "aktif = Monitoring Tag belum dilepas & belum delist; delist = diumumkan delist dalam 365 hari terakhir" };
  fs.writeFileSync(F, JSON.stringify(out, null, 1));
  console.log(`Monitoring Tag aktif: ${Object.keys(aktif).length} koin · diumumkan delist (365 hari): ${Object.keys(umumDelist).length} · dari ${A.length} judul`);
})();
