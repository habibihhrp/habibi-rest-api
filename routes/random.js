// Random endpoints — quote, waifu, fact
import express from "express";
import axios from "axios";
import { apikeyAuth, logSuccess } from "../lib/auth.js";
import { ok, fail, tryCatch } from "../lib/respond.js";

const router = express.Router();

// Built-in quote pool (Indonesian) — fallback supaya gak butuh upstream
const QUOTES = [
  { quote: "Kerja keras tidak akan mengkhianati hasil.", author: "Anonim" },
  { quote: "Mulailah dari yang kecil, tapi mulailah sekarang.", author: "Anonim" },
  { quote: "Hidup itu seperti sepeda — agar tetap seimbang, kamu harus terus bergerak.", author: "Albert Einstein" },
  { quote: "Sukses bukanlah akhir, kegagalan bukanlah keruntuhan: yang penting adalah keberanian untuk melanjutkan.", author: "Winston Churchill" },
  { quote: "Jangan menunggu kesempatan. Ciptakan kesempatan itu sendiri.", author: "George Bernard Shaw" },
  { quote: "Belajar dari hari kemarin, hidup di hari ini, berharap untuk hari esok.", author: "Albert Einstein" },
  { quote: "Cara terbaik untuk memprediksi masa depan adalah dengan menciptakannya.", author: "Peter Drucker" },
  { quote: "Kreativitas membutuhkan keberanian untuk melepaskan kepastian.", author: "Erich Fromm" },
  { quote: "Yang membedakan orang sukses dari yang biasa adalah bukan kekurangan kekuatan atau pengetahuan, melainkan kemauan.", author: "Vince Lombardi" },
  { quote: "Pendidikan adalah senjata paling ampuh untuk mengubah dunia.", author: "Nelson Mandela" },
];

router.get(
  "/quote",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const idx = Math.floor(Math.random() * QUOTES.length);
    logSuccess(req);
    return ok(res, QUOTES[idx]);
  }),
);

// GET /api/random/waifu?category=neko
// Source: nekos.best (public, no auth, very reliable)
// Falls back to api.waifu.pics if nekos.best is unreachable.
router.get(
  "/waifu",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const category = String(req.query.category || "neko").trim().toLowerCase();
    const allowed = [
      "neko", "kitsune", "husbando", "waifu",
      "baka", "bite", "blush", "bored", "cry", "cuddle", "dance",
      "facepalm", "feed", "happy", "highfive", "hug", "kick", "kiss",
      "laugh", "lurk", "nod", "nom", "nope", "pat", "peck", "poke",
      "pout", "punch", "shoot", "shrug", "slap", "sleep", "smile",
      "smug", "stare", "think", "thumbsup", "tickle", "wave", "wink", "yawn", "yeet",
    ];
    if (!allowed.includes(category)) {
      return fail(res, 400, `Invalid category. Allowed: ${allowed.join(", ")}`);
    }
    let r;
    try {
      r = await axios.get(`https://nekos.best/api/v2/${category}`, { timeout: 10000 });
      const item = r.data?.results?.[0];
      logSuccess(req);
      return ok(res, {
        category,
        image_url: item?.url,
        artist_name: item?.artist_name || null,
        source_url: item?.source_url || null,
      });
    } catch (e1) {
      // Fallback: api.waifu.pics
      try {
        r = await axios.get(`https://api.waifu.pics/sfw/${category}`, { timeout: 10000 });
        logSuccess(req);
        return ok(res, { category, image_url: r.data?.url });
      } catch (e2) {
        return fail(res, 502, `Both upstreams failed: ${e1.message}; ${e2.message}`);
      }
    }
  }),
);

// GET /api/random/fact — useless facts
router.get(
  "/fact",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const r = await axios.get(
      "https://uselessfacts.jsph.pl/random.json?language=en",
      { timeout: 10000 },
    );
    logSuccess(req);
    return ok(res, {
      fact: r.data?.text,
      source: r.data?.source_url,
    });
  }),
);

// ===== /api/random/joke — official-joke-api =====
router.get(
  "/joke",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const r = await axios.get("https://official-joke-api.appspot.com/random_joke", { timeout: 10000 });
    logSuccess(req);
    return ok(res, {
      type: r.data?.type,
      setup: r.data?.setup,
      punchline: r.data?.punchline,
    });
  }),
);

// ===== Built-in pools (Indonesian) =====
const GOMBAL = [
  "Kamu suka kopi? Aku juga. Tapi kamu lebih manis tanpa gula.",
  "Ngapain liat bintang? Aku aja di sini.",
  "Kalau kamu jadi soal matematika, aku rela kerjain berkali-kali.",
  "Cinta itu sederhana — kamu aja yang bikin ribet.",
  "Wifi-ku lemot, tapi koneksi ke kamu cepet banget.",
  "Aku bukan nasi, tapi aku bisa bikin kamu kenyang sama perhatian.",
  "Kalau cinta dihitung pakai data, kuota-ku unlimited buat kamu.",
  "Hatimu kayak browser — selalu nge-load aku.",
  "Aku gak butuh GPS, asal kamu jadi tujuan.",
  "Senyummu adalah dark mode untuk hari yang terlalu terang.",
];
const KATABIJAK = [
  { kata: "Hidup adalah perjalanan, bukan tujuan.", penulis: "Ralph Waldo Emerson" },
  { kata: "Jangan menghitung hari, buatlah hari berarti.", penulis: "Muhammad Ali" },
  { kata: "Pengetahuan adalah kekuatan.", penulis: "Francis Bacon" },
  { kata: "Mimpi tidak akan jadi kenyataan kalau kamu tidak bangun dan kerjain.", penulis: "Anonim" },
  { kata: "Kamu adalah apa yang kamu lakukan, bukan apa yang kamu ucapkan.", penulis: "Carl Jung" },
  { kata: "Setiap ahli pernah jadi pemula.", penulis: "Helen Hayes" },
  { kata: "Lakukan yang terbaik, tetap rendah hati.", penulis: "Anonim" },
  { kata: "Waktu yang baik untuk menanam pohon adalah 20 tahun lalu. Waktu terbaik kedua adalah sekarang.", penulis: "Pepatah Tiongkok" },
];
const DILAN = [
  "Jangan rindu, berat. Kamu nggak akan kuat. Biar aku saja.",
  "Cuma manusia yang cintai puisi yang bisa cintai dunia ini sebagaimana mestinya.",
  "Kau tahu kenapa hidup itu indah? Karena ada kamu di dalamnya.",
  "Kalau aku tidak datang ke sekolah hari ini, jangan rindu. Aku tahu kamu pasti rindu.",
  "Aku ramal hari ini kita akan ketemu. Tunggu saja.",
];
const FAKTA_ID = [
  "Indonesia memiliki lebih dari 17.000 pulau.",
  "Bahasa Indonesia memiliki lebih dari 700 dialek.",
  "Pulau Komodo adalah satu-satunya habitat alami komodo di dunia.",
  "Borobudur adalah candi Buddha terbesar di dunia.",
  "Indonesia adalah negara dengan populasi muslim terbesar di dunia.",
  "Danau Toba adalah danau vulkanik terbesar di dunia.",
  "Raflesia arnoldii — bunga terbesar di dunia — endemik Indonesia.",
];
const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

router.get(
  "/gombal",
  apikeyAuth,
  tryCatch(async (req, res) => {
    logSuccess(req);
    return ok(res, { gombal: pickRandom(GOMBAL) });
  }),
);

router.get(
  "/katabijak",
  apikeyAuth,
  tryCatch(async (req, res) => {
    logSuccess(req);
    return ok(res, pickRandom(KATABIJAK));
  }),
);

router.get(
  "/dilan",
  apikeyAuth,
  tryCatch(async (req, res) => {
    logSuccess(req);
    return ok(res, { quote: pickRandom(DILAN), source: "Film/Novel Dilan" });
  }),
);

router.get(
  "/fakta-id",
  apikeyAuth,
  tryCatch(async (req, res) => {
    logSuccess(req);
    return ok(res, { fakta: pickRandom(FAKTA_ID) });
  }),
);

// ===== /api/random/dog =====
router.get(
  "/dog",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const r = await axios.get("https://dog.ceo/api/breeds/image/random", { timeout: 10000 });
    logSuccess(req);
    return ok(res, { image_url: r.data?.message });
  }),
);

// ===== /api/random/cat =====
router.get(
  "/cat",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const r = await axios.get("https://api.thecatapi.com/v1/images/search", { timeout: 10000 });
    logSuccess(req);
    return ok(res, { image_url: r.data?.[0]?.url });
  }),
);

// ===== /api/random/meme =====
router.get(
  "/meme",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const r = await axios.get("https://meme-api.com/gimme", { timeout: 10000 });
    logSuccess(req);
    return ok(res, {
      title: r.data?.title,
      author: r.data?.author,
      subreddit: r.data?.subreddit,
      url: r.data?.url,
      post_link: r.data?.postLink,
    });
  }),
);

export default router;
