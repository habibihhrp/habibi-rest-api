// Downloader endpoints — TikTok, Instagram, YouTube
// Uses public scraper APIs that don't require login (best-effort, may break
// if upstream changes). Pure proxy + minimal normalization for response shape.
import express from "express";
import axios from "axios";
import { apikeyAuth, logSuccess } from "../lib/auth.js";
import { ok, fail, tryCatch } from "../lib/respond.js";

const router = express.Router();

const UA =
  process.env.SCRAPER_UA ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ===== TikTok via tikwm.com (public, no auth required) =====
const tiktokScraper = async (url) => {
  const r = await axios.post(
    "https://tikwm.com/api/",
    new URLSearchParams({ url, hd: "1" }),
    {
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 15000,
    },
  );
  if (r.data?.code !== 0) {
    throw new Error(r.data?.msg || "TikTok scrape failed");
  }
  const d = r.data.data;
  return {
    title: d.title,
    author: { name: d.author?.nickname, username: d.author?.unique_id },
    duration: d.duration,
    cover: d.cover,
    play: d.play, // direct mp4 URL (no watermark)
    play_hd: d.hdplay,
    music: d.music,
    images: d.images || null, // present for slideshows
    stats: {
      play: d.play_count,
      digg: d.digg_count,
      comment: d.comment_count,
      share: d.share_count,
    },
  };
};

// GET /api/downloader/tiktok?url=...
router.get(
  "/tiktok",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const { url } = req.query;
    if (!url) return fail(res, 400, "Missing ?url=");
    const data = await tiktokScraper(String(url));
    logSuccess(req);
    return ok(res, data);
  }),
);

// ===== Instagram via instagram-stories-api fallback to ddinstagram =====
// Uses a public mirror service. This is best-effort — IG actively breaks
// scrapers, so swap out if it goes down.
const instagramScraper = async (url) => {
  // Try snapinsta.app via direct page
  const r = await axios.post(
    "https://anydownloader.com/wp-json/aio-dl/video-data/",
    new URLSearchParams({ url, token: "5b03a26cef0e5d6e0eeae23abf21d9e0" }),
    {
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 20000,
    },
  );
  if (!r.data?.medias) {
    throw new Error("Instagram scrape failed (anydownloader returned no media)");
  }
  return {
    title: r.data.title || "",
    thumbnail: r.data.thumbnail || null,
    duration: r.data.duration || null,
    medias: r.data.medias.map((m) => ({
      url: m.url,
      type: m.type,
      quality: m.quality,
      extension: m.extension,
    })),
  };
};

router.get(
  "/instagram",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const { url } = req.query;
    if (!url) return fail(res, 400, "Missing ?url=");
    const data = await instagramScraper(String(url));
    logSuccess(req);
    return ok(res, data);
  }),
);

// ===== YouTube via savetube.me =====
const ytScraper = async (url) => {
  // Minimal info via youtube oEmbed (no scrape needed for metadata)
  const meta = await axios
    .get(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
      { timeout: 10000 },
    )
    .catch(() => ({ data: {} }));

  // Direct mp4/mp3 stream — use cobalt.tools public instance.
  // Cobalt is open-source and has documented API.
  const cobalt = await axios.post(
    "https://api.cobalt.tools/api/json",
    { url, vCodec: "h264", vQuality: "720", filenamePattern: "basic" },
    {
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 30000,
    },
  );
  if (!["stream", "redirect", "tunnel"].includes(cobalt.data?.status)) {
    throw new Error(cobalt.data?.text || "YouTube scrape failed");
  }
  return {
    title: meta.data.title || null,
    author: meta.data.author_name || null,
    thumbnail: meta.data.thumbnail_url || null,
    download_url: cobalt.data.url,
    type: cobalt.data.status,
  };
};

router.get(
  "/youtube",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const { url } = req.query;
    if (!url) return fail(res, 400, "Missing ?url=");
    const data = await ytScraper(String(url));
    logSuccess(req);
    return ok(res, data);
  }),
);

export default router;
