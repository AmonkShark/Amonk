/**
 * MODUL — peristiwa VALID persis seperti indikator goldencross/amonk_pola_dc.pine
 * (versi CALON 2026-09-17). Dipakai bersama supaya uji tidak menyalin aturan.
 *
 * Alur per bar (sama urutannya dengan Pine, semua di penutupan lilin):
 *   1. Directional Change m x ATR14/close (m 2.5 di 4H) -> titik baru SAH?
 *   2. PANTAU setup: tembus (satu VALID per bar, setup terbaru menang) / batal / basi
 *   3. titik baru -> bentuk() -> daftar(): SETUP, atau langsung VALID bila garis sudah
 *      tertembus <= 1 ATR (tembus duluan); saringan kunci, kembar, tumpang tindih 25%
 *   4. pelacak hasil horizon 24 bar (berbalik dihapus dari layar)
 *   5. pangkas: maks 4 pola VALID tampil
 * Aturan bentuk = mode KETAT modul uji_pola_klasik_semesta_baru (nilai disalin sebagai
 * konstanta DI SINI karena Pine juga menyalinnya; perubahan wajib di dua tempat).
 *
 * peristiwa(d, A, opsi) -> [{ i, nama, kode, lewat, level, tinggi, mulaiB, R24 }]
 * d = { t, o, h, l, c, v }, A = ATR14 (Wilder).
 */
const C = {
  mx: 2.5, tolEks: 3, tolBahu: 4, tolLeher: 4, minAntara: 10, minJarak: 10,
  minTiang: 15, maksBalik: 45, umur3: 90, umur5: 140, umurSetup: 60, maksSetup: 4,
  maksValid: 4, maksTumpang: 25, maksLewat: 1.0, horizon: 24, ambangBalik: 1.0,
};
// Peringkat uji (Pine: fungsi `peringkat`) — dipakai mengurutkan CALON.
const PERINGKAT = k => ({ FW: 1, ST: 2, PEN: 3, IHS: 4, AT: 5, TB: 6, CH: 7, RC: 8, DB: 9 }[k] || 10);
const dekat = (a, b, p) => a > 0 && b > 0 && Math.abs(a / b - 1) * 100 <= p;
const garis = (b1, p1, b2, p2, x) => b2 === b1 ? p2 : p1 + (p2 - p1) / (b2 - b1) * (x - b1);
const lvlDi = (q, x) => q.miring ? garis(q.uaB, q.uaP, q.ubB, q.ubP, x) : q.lvl;
const batDi = (q, x) => q.batalMiring ? garis(q.laB, q.laP, q.lbB, q.lbP, x) : q.batal;
const bawahDi = (q, x) => garis(q.laB, q.laP, q.lbB, q.lbP, x);

/** Semua bentuk dari daftar titik P (terakhir = P[n-1]), urutan = prioritas Pine. */
function bentuk(P, i) {
  const out = [], n = P.length;
  if (n < 3) return out;
  const pk = k => P[n - k], t1 = pk(1);
  if (n >= 5 && !t1.hi) {
    const [p1, p2, p3, p4, p5] = [pk(5), pk(4), pk(3), pk(2), t1];
    if (i - p1.b <= C.umur5) {
      if (p3.p < p1.p && p3.p < p5.p && dekat(p1.p, p5.p, C.tolBahu) && dekat(p2.p, p4.p, C.tolLeher)) {
        const neck = (p2.p + p4.p) / 2;
        out.push({ nama: "Inverse H&S", kode: "IHS", lvl: neck, uaB: p1.b, batal: p3.p, tinggi: neck - p3.p, kr: [p1, p2, p3, p4, p5] });
      }
      if (dekat(p1.p, p3.p, C.tolEks) && dekat(p3.p, p5.p, C.tolEks) && dekat(p1.p, p5.p, C.tolEks)) {
        const atas = Math.max(p2.p, p4.p), dasar = Math.min(p1.p, p3.p, p5.p);
        out.push({ nama: "Triple Bottom", kode: "TB", lvl: atas, uaB: p1.b, batal: dasar, tinggi: atas - dasar, kr: [p1, p2, p3, p4, p5] });
      }
    }
  }
  if (n >= 4 && !t1.hi) {
    const [c1, c2, c3, c4] = [pk(4), pk(3), pk(2), t1];
    const um = i - c1.b;
    if (c1.hi && um >= 30 && um <= 160 && c1.p > 0 && c3.p > 0 &&
        (1 - c2.p / c1.p) * 100 >= 15 && (1 - c3.p / c1.p) * 100 <= 6 && (1 - c4.p / c3.p) * 100 <= 12 && c4.p > c2.p) {
      const bibir = Math.max(c1.p, c3.p);
      out.push({ nama: "Cup & Handle", kode: "CH", lvl: bibir, uaB: c1.b, batal: (c1.p + c2.p) / 2, tinggi: bibir - c2.p, kr: [c1, c2, c3, c4] });
    }
  }
  if (n >= 4) {
    const [s1, s2, s3, s4] = [pk(4), pk(3), pk(2), t1];
    const hh1 = s1.hi ? s1 : s2, hh0 = s1.hi ? s3 : s4, ll1 = s1.hi ? s2 : s1, ll0 = s1.hi ? s4 : s3;
    const lA = Math.abs(hh1.p - ll1.p), lB = Math.abs(hh0.p - ll0.p);
    if (i - Math.min(hh1.b, ll1.b) <= C.umur3 && lA > 0) {
      const fw = hh0.p < hh1.p && ll0.p < ll1.p && lB < lA * 0.8;
      const at = dekat(hh0.p, hh1.p, 1.5) && ll0.p > ll1.p * 1.01;
      const st = hh0.p < hh1.p * 0.99 && ll0.p > ll1.p * 1.01;
      if (fw || at || st) {
        let tiang = null;
        if (st && s1.hi && n >= 5) { const s0 = pk(5), nt = hh1.p - s0.p; if (!s0.hi && s0.p > 0 && nt / s0.p * 100 >= C.minTiang && nt > lA) tiang = s0; }
        const nama = fw ? "Falling Wedge" : at ? "Ascending Triangle" : tiang ? "Bullish Pennant" : "Symmetrical Triangle";
        const kode = fw ? "FW" : at ? "AT" : tiang ? "PEN" : "ST";
        const lvl = Math.max(hh0.p, hh1.p);
        out.push({ nama, kode, miring: !at, lvl, uaB: hh1.b, uaP: hh1.p, ubB: hh0.b, ubP: hh0.p,
          adaBawah: true, laB: ll1.b, laP: ll1.p, lbB: ll0.b, lbP: ll0.p, batalMiring: true,
          tinggi: at ? lvl - ll1.p : lA, tiang, kr: [s1, s2, s3, s4] });
      }
    }
  }
  if (n >= 3 && !t1.hi) {
    const a = pk(3), b = pk(2), d = t1;
    if (i - a.b <= C.umur3) {
      const dasar = Math.min(a.p, d.p);
      if (dekat(a.p, d.p, C.tolEks) && (b.p - dasar) / dasar * 100 >= C.minAntara && d.b - a.b >= C.minJarak)
        out.push({ nama: "Double Bottom", kode: "DB", lvl: b.p, uaB: a.b, batal: dasar, tinggi: b.p - dasar, kr: n >= 4 ? [pk(4), a, b, d] : [a, b, d] });
      const tg = b.p - a.p;
      if (tg > 0 && tg / a.p * 100 >= C.minTiang && b.p - d.p <= C.maksBalik / 100 * tg)
        out.push({ nama: "Bull Flag", kode: "BF", lvl: b.p, uaB: b.b, batal: b.p - C.maksBalik / 100 * tg, tinggi: tg, tiang: a, kr: [b, d] });
    }
  }
  if (n >= 5) {
    const [r1, r2, r3, r4, r5] = [pk(5), pk(4), pk(3), pk(2), t1];
    if (i - r1.b <= C.umur5) {
      const h0 = r1.hi ? r1.p : r2.p, h1 = r1.hi ? r3.p : r4.p, g0 = r1.hi ? r2.p : r1.p, g1 = r1.hi ? r4.p : r3.p;
      const atas = r1.hi ? Math.max(r1.p, r3.p, r5.p) : Math.max(r2.p, r4.p);
      const bawah = r1.hi ? Math.min(r2.p, r4.p) : Math.min(r1.p, r3.p, r5.p);
      if (dekat(h0, h1, 2.5) && dekat(g0, g1, 2.5) && atas / bawah - 1 > 0.04)
        out.push({ nama: "Rectangle", kode: "RC", lvl: atas, uaB: r1.b, adaBawah: true, laB: r1.b, laP: bawah, lbB: r5.b, lbP: bawah,
          batal: bawah, tinggi: atas - bawah, kr: [r1, r2, r3, r4, r5] });
    }
  }
  for (const q of out) {
    q.kunci = t1.b;
    // titik awal "makna pola" (2026-09-17, uji titik awal per pola): lembah pertama DB,
    // dasar tiang BF/PEN, puncak pertama wedge/segitiga, titik pertama kerangka lainnya
    if (q.kode === "DB") q.titikAwal = q.kr[q.kr.length - 3];
    else if (q.kode === "BF" || q.kode === "PEN") q.titikAwal = q.tiang;
    else if (q.kode === "FW" || q.kode === "AT" || q.kode === "ST") q.titikAwal = q.kr.find(k => k.b === q.uaB);
    else q.titikAwal = q.kr[0];
  }
  return out;
}

// ELLIOTT WAVE (kode EW) — DITAMBAHKAN 2026-09-23, permintaan user: "sinkronkan semua ke routine
// dengan nama elliot seperti falling wedge ... masuk ke pola 4h, dan masukkan juga ke amonk monitor".
// Replika SETIA blok "DC ENTRY (siklus bernomor)" di AMONK SINYAL - LOGIKA/GARIS (ew*), yang disalin
// dari amonk_dc_fib_gz_rapi.pine. Urutan per bar SAMA dengan Pine:
//   1. pembatal lembah 0 (low < L0 saat no>=1) -> siklus batal, limit dibuang
//   2. low < L2 saat no 3/4 -> batal
//   3. Directional Change mx x ATR/close; penomoran 0-5; gagal di 3 (P3<=P1) / 5 (P5<=P3)
//   4. SETUP di titik 3: ayunan gel.3 >= 20% DAN titik 0 tidak sebelum titik 3 setup lalu;
//      limit = P3 - dalam x (P3 - L2), dalam 0.90 (>=2H) / 0.57 (<=1H)
//   5. isian di bar yang sama sudah boleh: open < limit = GAP (batal), low <= limit = TERISI
//   6. tidak terisi > 60 bar = kedaluwarsa
// Keluaran dibentuk SEPERTI pola supaya semua pemakai (aplikasi, Telegram, rutin) langsung bisa:
//   VALID = limit TERISI: entry = limit (bukan close), batal = SL = entry - 2.5 ATR bar isian,
//   level + tinggi = PUNCAK 3 (TP2 buku Elliott). TP1 dihitung pemakai dengan aturan aplikasi.
// Hanya dijalankan bila opsi.elliott === true, supaya skrip riset lama tetap menghasilkan angka yang sama.
const EW = { ayun: 20, tunggu: 60, slAtr: 2.5 };
function elliott(d, A, mx) {
  const n = d.c.length, dalam = mx >= 3 ? 0.57 : 0.90;   // Pine: <=1H m 3.5 & 0.57, >=2H m 2.5 & 0.90
  const valid = [], semua = [];        // semua = riwayat tiap limit (untuk uji pemilih; tidak dipakai app/bot)
  let cur = null;                      // limit yang sedang hidup di riwayat
  const tutupCur = i => { if (cur && cur.akhirB == null) cur.akhirB = i; cur = null; };
  let naik = true, eks = null, eksB = 0, no = -1, batal = false;
  let low0 = null, b0 = null, high1 = null, low2 = null, high3 = null, b3 = null;
  let p3Lalu = -1e9, level = null, lahir = null, terisi = false, tpBuku = null, setupB0 = null, ayunS = null;
  for (let i = 0; i < n; i++) {
    const hi = d.h[i], lo = d.l[i];
    if (eks === null) { eks = d.c[i]; eksB = i; }
    // 1-2. pembatal tiap bar
    if (no >= 1 && !batal && low0 !== null && lo < low0) { if (!terisi) tutupCur(i); batal = true; level = null; lahir = null; terisi = false; }
    if ((no === 3 || no === 4) && !batal && low2 !== null && lo < low2) batal = true;
    // 3. detektor
    const th = A[i] > 0 && d.c[i] > 0 ? mx * A[i] / d.c[i] : null;
    let titik3 = false;
    if (th !== null) {
      if (naik) {
        if (hi > eks) { eks = hi; eksB = i; }
        else if (lo <= eks * (1 - th)) {
          no = (batal || no < 0) ? -1 : no + 1;
          const gagal = (no === 3 && high1 !== null && eks <= high1) || (no === 5 && high3 !== null && eks <= high3);
          if (gagal) {
            if (lahir !== null && !terisi) { level = null; lahir = null; tutupCur(i); }
            batal = true; no = -1;
          }
          if (no === 3) { high3 = eks; b3 = eksB; titik3 = true; }
          if (no === 1) high1 = eks;
          naik = false; eks = lo; eksB = i;
        }
      } else {
        if (lo < eks) { eks = lo; eksB = i; }
        else if (hi >= eks * (1 + th)) {
          let calon = (no < 0 || no >= 5 || batal) ? 0 : no + 1;
          if (calon >= 2 && low0 !== null && eks < low0) calon = 0;
          if (calon === 4 && low2 !== null && eks < low2) calon = 0;
          no = calon;
          if (no === 0) { batal = false; low0 = eks; b0 = eksB; low2 = null; high1 = null; high3 = null; }
          if (no === 2) low2 = eks;
          naik = true; eks = hi; eksB = i;
        }
      }
    }
    // 4. setup di titik 3
    if (titik3 && low0 !== null && low2 !== null && high1 !== null && b0 !== null) {
      const g3 = high3 - low2;
      const ayunOk = g3 > 0 && low2 > 0 && g3 / low2 * 100 >= EW.ayun;
      if (ayunOk && b0 >= p3Lalu) {
        if (!terisi) tutupCur(i); else cur = null;          // limit lama yang belum terisi diganti
        p3Lalu = b3; level = high3 - dalam * g3; tpBuku = high3; lahir = i; terisi = false;
        setupB0 = b0; ayunS = g3 / low2 * 100;
        cur = { lahirB: i, level, tpBuku, ayun: ayunS, b0, akhirB: null, isiB: null }; semua.push(cur);
      } else batal = true;
    }
    // 5. isian
    let gap = false;
    if (level !== null && !terisi) {
      if (d.o[i] < level) gap = true;
      else if (lo <= level && A[i] > 0) {
        terisi = true;
        if (cur) { cur.isiB = i; cur.akhirB = i; cur = null; }
        const sl = level - EW.slAtr * A[i], j = i + C.horizon;
        valid.push({ i, nama: "Elliott Wave", kode: "EW", lewat: false, level, entry: level, batal: sl,
          tinggi: tpBuku - level, mulaiB: setupB0, lahirB: lahir, ayun: ayunS,
          awal: { hi: false, p: low0, b: setupB0 }, titikAwal: { hi: false, p: low0, b: setupB0 },
          R24: j < n ? (d.c[j] - level) / A[i] : NaN });
      }
    }
    // 6. batal karena gap / waktu
    if (lahir !== null && !terisi && (gap || i - lahir > EW.tunggu)) { level = null; lahir = null; tutupCur(i); }
  }
  const i = n - 1;
  const setup = level !== null && !terisi && lahir !== null && A[i] > 0
    ? { nama: "Elliott Wave (limit beli)", kode: "EW", limit: true, level, batal: level - EW.slAtr * A[i],
        lahirB: lahir, umur: i - lahir, sisa: EW.tunggu - (i - lahir), mulaiB: setupB0, tinggi: tpBuku - level, ayun: ayunS }
    : null;
  return { valid, setup, semua };
}

// opsi.setupAkhir DITAMBAHKAN 2026-09-19: kalau true, larik hasil ikut membawa
// properti `.setup` = pola berstatus SETUP (belum tembus) yang masih hidup di bar
// terakhir. Default {} -> perilaku & isi larik PERSIS seperti sebelumnya.
function peristiwa(d, A, opsi = {}) {
  const n = d.c.length, pv = [], semua = [], hasil = [];
  // opsi.mx DITAMBAHKAN 2026-09-20: ambang Directional Change. Bawaan C.mx (2.5 =
  // setelan 4H). Pine memakai 3.5 di TF <= 1H, jadi uji lintas-TF WAJIB mengoper
  // mx = 3.5 untuk 1H — kalau tidak, yang dibandingkan bukan TF-nya tapi ambangnya.
  const MX = opsi.mx > 0 ? opsi.mx : C.mx;
  let naik = true, eks = null, eksB = null;
  for (let i = 0; i < n; i++) {
    // 1. DC
    let baru = false;
    if (eks === null) { eks = d.c[i]; eksB = i; }
    else if (A[i] > 0 && d.c[i] > 0) {
      const th = MX * A[i] / d.c[i];
      if (naik) {
        if (d.h[i] > eks) { eks = d.h[i]; eksB = i; }
        else if (d.l[i] <= eks * (1 - th)) { pv.push({ hi: true, p: eks, b: eksB }); baru = true; naik = false; eks = d.l[i]; eksB = i; }
      } else {
        if (d.l[i] < eks) { eks = d.l[i]; eksB = i; }
        else if (d.h[i] >= eks * (1 + th)) { pv.push({ hi: false, p: eks, b: eksB }); baru = true; naik = true; eks = d.h[i]; eksB = i; }
      }
    }
    if (pv.length > 12) pv.shift();
    const c = d.c[i];
    // 2. PANTAU
    let validBar = false;
    for (let j = semua.length - 1; j >= 0; j--) {
      const q = semua[j];
      if (q.status !== 0) continue;
      const lv = lvlDi(q, i), bt = batDi(q, i);
      const ujung = q.adaBawah && q.miring && lv <= bawahDi(q, i);
      if (c > lv && !ujung && validBar) semua.splice(j, 1);
      else if (c > lv && !ujung) { jadiValid(q, i, lv, false); validBar = true; }
      else if (c < bt || ujung || i - q.lahirB > C.umurSetup) semua.splice(j, 1);
    }
    // 3. pola baru
    if (baru) {
      // URUTAN PERINGKAT — disamakan dengan Pine 2026-09-20 (persetujuan user).
      // Sejak POLA v51 Pine memakai `urutPeringkat()`: pada titik yang SAMA, pola
      // berperingkat uji lebih baik didahulukan. Modul ini dulu memakai urutan
      // BENTUK (urutan fungsi `bentuk`), jadi saat dua pola lahir di titik yang
      // sama, rutin dan chart bisa memilih pola yang berbeda.
      // TERUKUR 2026-09-20 (40 koin 4H): 69 dari 279 pola valid — seperempatnya —
      // dipilih berbeda. Itu sebab daftar pola ROSE tidak cocok dengan chart.
      for (const p of bentuk(pv, i).sort((a, b) => PERINGKAT(a.kode) - PERINGKAT(b.kode))) {
        const lv = lvlDi(p, i), bt = batDi(p, i);
        let mulai = p.uaB;
        if (p.adaBawah) mulai = Math.min(mulai, p.laB);
        if (p.tiang) mulai = Math.min(mulai, p.tiang.b);
        let akhir = mulai;
        for (const k of p.kr) { mulai = Math.min(mulai, k.b); akhir = Math.max(akhir, k.b); }
        p.mulaiB = mulai;
        const lebar = Math.max(1, akhir - mulai);
        const ada = bentrok(p, lv, i, akhir, mulai, lebar);
        const dasarOk = !ada && Number.isFinite(lv) && Number.isFinite(bt) && c >= bt && lv > bt;
        const nSetup = semua.filter(q => q.status === 0).length;
        p.status = 0; p.lahirB = i; p.tampil = true;
        if (dasarOk && c <= lv && nSetup < C.maksSetup) semua.push(p);
        else if (dasarOk && c > lv && !validBar && c - lv <= C.maksLewat * A[i] && !(p.adaBawah && p.miring && lv <= bawahDi(p, i))) {
          semua.push(p); jadiValid(p, i, lv, true); validBar = true;
        }
      }
    }
    // 4. hasil (horizon)
    for (let j = semua.length - 1; j >= 0; j--) {
      const q = semua[j];
      if (q.status === 1 && !q.selesai && i - q.tembusB >= C.horizon) {
        q.selesai = true;
        const s = (c - q.acuan) / Math.max(A[i], 1e-12);
        if (s <= -C.ambangBalik) semua.splice(j, 1);          // berbalik -> dihapus
        else if (!q.tampil) semua.splice(j, 1);
      }
    }
    // 5. pangkas
    let nV = semua.filter(q => q.status === 1 && q.tampil).length;
    while (nV > C.maksValid) {
      const k = semua.findIndex(q => q.status === 1 && q.tampil);
      if (semua[k].selesai) semua.splice(k, 1); else semua[k].tampil = false;
      nV--;
    }
    while (semua.length > 80) semua.shift();
  }
  // BENTROK — saringan yang sama untuk SETUP dan CALON (Pine: fungsi `bentrok`).
  // Dipisah 2026-09-20 saat CALON ditambahkan; isinya SALINAN PERSIS dari kode
  // yang tadinya sebaris di langkah 3, supaya hasil rutin lama tidak berubah.
  function bentrok(p, lv, i, akhir, mulai, lebar) {
    let ada = false;
    for (const q of semua) {
      if (q.kunci === p.kunci) ada = true;
      else if (q.status === 0 && q.kode === p.kode && lv > 0 && Math.abs(lvlDi(q, i) / lv - 1) < 0.002) ada = true;
      else if (q.tampil) {
        const qA = q.status === 1 ? q.tembusB : i;
        const ir = Math.min(akhir, qA) - Math.max(mulai, q.mulaiB);
        if (ir > 0 && 100 * ir / lebar > C.maksTumpang) ada = true;
      }
    }
    return ada;
  }

  function jadiValid(q, i, lv, lewat) {
    q.status = 1; q.tembusB = i; q.acuan = d.c[i]; q.lewat = lewat;
    const j = i + C.horizon;
    hasil.push({ i, nama: q.nama, kode: q.kode, lewat, level: lv, tinggi: q.tinggi, mulaiB: q.mulaiB,
      batal: batDi(q, i), // garis batal di bar valid (ditambahkan 2026-09-17 untuk uji TP/SL buku)
      awal: q.kr[0],      // titik ayunan pertama kerangka {hi,p,b} (ditambahkan 2026-09-17 untuk uji titik awal)
      titikAwal: q.titikAwal, // titik awal bermakna per pola (lihat bentuk())
      R24: j < n && A[i] > 0 ? (d.c[j] - d.c[i]) / A[i] : NaN });
  }
  if (opsi.setupAkhir) {
    const i = n - 1;
    hasil.setup = semua.filter(q => q.status === 0).map(q => ({
      nama: q.nama, kode: q.kode, level: lvlDi(q, i), batal: batDi(q, i),
      lahirB: q.lahirB, umur: i - q.lahirB, sisa: C.umurSetup - (i - q.lahirB),
      mulaiB: q.mulaiB, tinggi: q.tinggi }));
  }
  // opsi.calonAkhir DITAMBAHKAN 2026-09-20: tahap SEBELUM setup. Selama DC masih
  // mencari lembah (naik === false), lembah terendah sejauh ini dipakai sebagai
  // titik SEMENTARA dan bentuk() dijalankan dengan titik itu — persis blok CALON
  // di amonk_pola_dc.pine (urut peringkat, maks `maksCalon`, satu kode sekali,
  // wajib close di antara garis batal dan garis tembus, lolos saringan bentrok).
  // `sahP` = harga yang membuat lembah sementara itu SAH menurut DC.
  if (opsi.calonAkhir) {
    const i = n - 1, c0 = d.c[i];
    const maks = opsi.maksCalon || 4;
    hasil.calon = [];
    if (!naik && eks != null && A[i] > 0 && c0 > 0) {
      const th = MX * A[i] / c0;
      const tmp = pv.slice();
      tmp.push({ hi: false, p: eks, b: eksB });
      const arr = bentuk(tmp, i).sort((a, b) => PERINGKAT(a.kode) - PERINGKAT(b.kode));
      for (const p of arr) {
        if (hasil.calon.length >= maks) break;
        const lv = lvlDi(p, i), bt = batDi(p, i);
        if (!Number.isFinite(lv) || !Number.isFinite(bt)) continue;
        if (!(c0 <= lv && c0 >= bt && lv > bt)) continue;
        if (hasil.calon.some(x => x.kode === p.kode)) continue;
        let mulai = p.uaB;
        if (p.adaBawah) mulai = Math.min(mulai, p.laB);
        if (p.tiang) mulai = Math.min(mulai, p.tiang.b);
        let akhir = mulai;
        for (const k of p.kr) { mulai = Math.min(mulai, k.b); akhir = Math.max(akhir, k.b); }
        p.mulaiB = mulai;
        if (bentrok(p, lv, i, akhir, mulai, Math.max(1, akhir - mulai))) continue;
        hasil.calon.push({ nama: p.nama, kode: p.kode, nomor: PERINGKAT(p.kode),
          level: lv, batal: bt, sahP: eks * (1 + th), lembahP: eks, lembahB: eksB,
          umurLembah: i - eksB, mulaiB: mulai, tinggi: p.tinggi });
      }
    }
  }
  // ELLIOTT (opsi.elliott): VALID digabung urut bar (pola lain tetap berurutan seperti semula);
  // limit yang masih menunggu ikut ke hasil.setup bila setupAkhir.
  if (opsi.elliott) {
    const ew = elliott(d, A, MX);
    if (ew.valid.length) {
      const setup = hasil.setup, calon = hasil.calon;
      const gabung = hasil.concat(ew.valid).map((e, k) => [e, k]).sort((a, b) => a[0].i - b[0].i || a[1] - b[1]).map(x => x[0]);
      hasil.length = 0; hasil.push(...gabung);
      if (setup) hasil.setup = setup;
      if (calon) hasil.calon = calon;
    }
    if (opsi.setupAkhir && ew.setup) hasil.setup.push(ew.setup);
  }
  return hasil;
}

module.exports = { peristiwa, bentuk, C, elliott, EW };
