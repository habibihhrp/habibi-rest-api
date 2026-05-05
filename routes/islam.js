// Islamic endpoints — jadwal sholat, asmaul husna, surah, hadits
import express from "express";
import axios from "axios";
import { apikeyAuth, logSuccess } from "../lib/auth.js";
import { ok, fail, tryCatch } from "../lib/respond.js";

const router = express.Router();
const UA =
  process.env.SCRAPER_UA ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// GET /api/islam/jadwal-sholat?city=Jakarta
// Uses aladhan.com (free, no auth).
router.get(
  "/jadwal-sholat",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const city = String(req.query.city || "Jakarta").trim();
    const country = String(req.query.country || "Indonesia").trim();
    const r = await axios.get("https://api.aladhan.com/v1/timingsByCity", {
      params: { city, country, method: 11 }, // method 11 = Kementerian Agama RI
      timeout: 20000,
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    const d = r.data?.data;
    if (!d) return fail(res, 502, "Jadwal sholat upstream error");
    logSuccess(req);
    return ok(res, {
      location: { city, country },
      date: d.date?.readable,
      hijri: d.date?.hijri?.date,
      timings: {
        Imsak: d.timings?.Imsak,
        Subuh: d.timings?.Fajr,
        Terbit: d.timings?.Sunrise,
        Dzuhur: d.timings?.Dhuhr,
        Ashar: d.timings?.Asr,
        Maghrib: d.timings?.Maghrib,
        Isya: d.timings?.Isha,
      },
    });
  }),
);

// GET /api/islam/asmaul-husna  -> random Asmaul Husna
const ASMAUL_HUSNA = [
  { no: 1, latin: "Ar-Rahman", arab: "ٱلرَّحْمَٰنُ", arti: "Yang Maha Pengasih" },
  { no: 2, latin: "Ar-Rahim", arab: "ٱلرَّحِيمُ", arti: "Yang Maha Penyayang" },
  { no: 3, latin: "Al-Malik", arab: "ٱلْمَلِكُ", arti: "Yang Maha Merajai/Memerintah" },
  { no: 4, latin: "Al-Quddus", arab: "ٱلْقُدُّوسُ", arti: "Yang Maha Suci" },
  { no: 5, latin: "As-Salam", arab: "ٱلسَّلَامُ", arti: "Yang Maha Memberi Kesejahteraan" },
  { no: 6, latin: "Al-Mu'min", arab: "ٱلْمُؤْمِنُ", arti: "Yang Maha Memberi Keamanan" },
  { no: 7, latin: "Al-Muhaymin", arab: "ٱلْمُهَيْمِنُ", arti: "Yang Maha Pemelihara" },
  { no: 8, latin: "Al-'Aziz", arab: "ٱلْعَزِيزُ", arti: "Yang Maha Perkasa" },
  { no: 9, latin: "Al-Jabbar", arab: "ٱلْجَبَّارُ", arti: "Yang Memiliki Mutlak Kegagahan" },
  { no: 10, latin: "Al-Mutakabbir", arab: "ٱلْمُتَكَبِّرُ", arti: "Yang Maha Megah" },
];
router.get(
  "/asmaul-husna",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const noParam = parseInt(req.query.no || "0", 10);
    const item =
      noParam >= 1 && noParam <= ASMAUL_HUSNA.length
        ? ASMAUL_HUSNA[noParam - 1]
        : ASMAUL_HUSNA[Math.floor(Math.random() * ASMAUL_HUSNA.length)];
    logSuccess(req);
    return ok(res, {
      ...item,
      total_built_in: ASMAUL_HUSNA.length,
      note: "Subset 10 nama. Untuk 99 lengkap pakai upstream eksternal.",
    });
  }),
);

// GET /api/islam/surah?nomor=1
// Uses equran.id v2 (free, no auth)
router.get(
  "/surah",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const nomor = parseInt(req.query.nomor || "0", 10);
    if (!nomor || nomor < 1 || nomor > 114) {
      return fail(res, 400, "?nomor= must be 1..114");
    }
    const r = await axios.get(`https://equran.id/api/v2/surat/${nomor}`, {
      timeout: 15000,
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    const d = r.data?.data;
    if (!d) return fail(res, 502, "equran.id upstream error");
    logSuccess(req);
    return ok(res, {
      nomor: d.nomor,
      nama: d.namaLatin,
      arab: d.nama,
      arti: d.arti,
      jumlah_ayat: d.jumlahAyat,
      tempat_turun: d.tempatTurun,
      deskripsi: (d.deskripsi || "").replace(/<[^>]+>/g, ""),
      audio: d.audioFull?.["05"] || null,
      ayat_count: (d.ayat || []).length,
    });
  }),
);

// GET /api/islam/hadits?perawi=bukhari&nomor=1
// Uses gadingnst api-hadits (free, no auth).
router.get(
  "/hadits",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const perawi = String(req.query.perawi || "bukhari").toLowerCase().trim();
    const nomor = parseInt(req.query.nomor || "1", 10);
    const allowed = [
      "abu-daud", "ahmad", "bukhari", "darimi", "ibnu-majah",
      "malik", "muslim", "nasai", "tirmidzi",
    ];
    if (!allowed.includes(perawi)) {
      return fail(res, 400, `perawi must be one of: ${allowed.join(", ")}`);
    }
    if (nomor < 1) return fail(res, 400, "?nomor= must be >= 1");
    const r = await axios.get(`https://api.hadith.gading.dev/books/${perawi}/${nomor}`, {
      timeout: 15000,
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    const d = r.data?.data;
    if (!d?.contents) return fail(res, 404, `Hadits ${perawi} #${nomor} tidak ditemukan`);
    logSuccess(req);
    return ok(res, {
      perawi: d.name,
      nomor: d.contents.number,
      arab: d.contents.arab,
      indonesia: d.contents.id,
    });
  }),
);

export default router;
