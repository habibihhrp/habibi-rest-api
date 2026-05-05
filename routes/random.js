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

export default router;
