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

// ===== YouTube MP4 (explicit) =====
// Same as /youtube but allows quality override via ?quality=720|480|360
router.get(
  "/ytmp4",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const url = String(req.query.url || "").trim();
    const quality = String(req.query.quality || "720").trim();
    if (!url) return fail(res, 400, "Missing ?url=");
    if (!["144", "240", "360", "480", "720", "1080"].includes(quality)) {
      return fail(res, 400, "quality must be 144|240|360|480|720|1080");
    }
    const meta = await axios
      .get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { timeout: 10000 })
      .catch(() => ({ data: {} }));
    const cobalt = await axios.post(
      "https://api.cobalt.tools/api/json",
      { url, vCodec: "h264", vQuality: quality, filenamePattern: "basic" },
      { headers: { "User-Agent": UA, "Content-Type": "application/json", Accept: "application/json" }, timeout: 30000 },
    );
    if (!["stream", "redirect", "tunnel"].includes(cobalt.data?.status)) {
      return fail(res, 502, cobalt.data?.text || "ytmp4 upstream failed");
    }
    logSuccess(req);
    return ok(res, {
      title: meta.data.title || null,
      author: meta.data.author_name || null,
      thumbnail: meta.data.thumbnail_url || null,
      quality,
      format: "mp4",
      download_url: cobalt.data.url,
    });
  }),
);

// ===== YouTube MP3 (audio only) =====
router.get(
  "/ytmp3",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const url = String(req.query.url || "").trim();
    if (!url) return fail(res, 400, "Missing ?url=");
    const meta = await axios
      .get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { timeout: 10000 })
      .catch(() => ({ data: {} }));
    const cobalt = await axios.post(
      "https://api.cobalt.tools/api/json",
      { url, isAudioOnly: true, aFormat: "mp3", filenamePattern: "basic" },
      { headers: { "User-Agent": UA, "Content-Type": "application/json", Accept: "application/json" }, timeout: 30000 },
    );
    if (!["stream", "redirect", "tunnel"].includes(cobalt.data?.status)) {
      return fail(res, 502, cobalt.data?.text || "ytmp3 upstream failed");
    }
    logSuccess(req);
    return ok(res, {
      title: meta.data.title || null,
      author: meta.data.author_name || null,
      thumbnail: meta.data.thumbnail_url || null,
      format: "mp3",
      download_url: cobalt.data.url,
    });
  }),
);

// ===== Facebook video — via cobalt =====
router.get(
  "/facebook",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const url = String(req.query.url || "").trim();
    if (!url) return fail(res, 400, "Missing ?url=");
    if (!/facebook\.com|fb\.watch/i.test(url)) {
      return fail(res, 400, "url must be a facebook.com or fb.watch link");
    }
    const cobalt = await axios.post(
      "https://api.cobalt.tools/api/json",
      { url, vCodec: "h264", vQuality: "720" },
      { headers: { "User-Agent": UA, "Content-Type": "application/json", Accept: "application/json" }, timeout: 30000 },
    );
    if (!["stream", "redirect", "tunnel"].includes(cobalt.data?.status)) {
      return fail(res, 502, cobalt.data?.text || "Facebook scrape failed");
    }
    logSuccess(req);
    return ok(res, { source: "facebook", download_url: cobalt.data.url });
  }),
);

// ===== Twitter / X video =====
router.get(
  "/twitter",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const url = String(req.query.url || "").trim();
    if (!url) return fail(res, 400, "Missing ?url=");
    if (!/(twitter\.com|x\.com)\/[^/]+\/status\//i.test(url)) {
      return fail(res, 400, "url must be a twitter.com or x.com status URL");
    }
    // fxtwitter exposes a public JSON API at api.fxtwitter.com (currently maintained)
    const apiUrl = url
      .replace(/^https?:\/\/(twitter\.com|x\.com)/i, "https://api.fxtwitter.com");
    const r = await axios.get(apiUrl, {
      timeout: 15000,
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    const tw = r.data?.tweet;
    if (!tw) {
      return fail(res, 404, r.data?.message || "Tweet not found");
    }
    const medias = (tw.media?.all || []).map((m) => ({
      type: m.type,
      url: m.url,
      thumbnail: m.thumbnail_url || null,
      width: m.width,
      height: m.height,
      duration: m.duration || null,
    }));
    logSuccess(req);
    return ok(res, {
      url: tw.url,
      author: {
        name: tw.author?.name,
        username: tw.author?.screen_name,
        avatar: tw.author?.avatar_url,
      },
      text: tw.text,
      created_at: tw.created_at,
      stats: {
        likes: tw.likes || 0,
        retweets: tw.retweets || 0,
        replies: tw.replies || 0,
        views: tw.views || 0,
      },
      medias,
    });
  }),
);

// ===== Threads (Meta) — via cobalt =====
router.get(
  "/threads",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const url = String(req.query.url || "").trim();
    if (!url) return fail(res, 400, "Missing ?url=");
    if (!/threads\.net/i.test(url)) {
      return fail(res, 400, "url must be a threads.net link");
    }
    const cobalt = await axios.post(
      "https://api.cobalt.tools/api/json",
      { url, vCodec: "h264", vQuality: "720" },
      { headers: { "User-Agent": UA, "Content-Type": "application/json", Accept: "application/json" }, timeout: 30000 },
    );
    if (!["stream", "redirect", "tunnel", "picker"].includes(cobalt.data?.status)) {
      return fail(res, 502, cobalt.data?.text || "Threads scrape failed");
    }
    logSuccess(req);
    return ok(res, {
      source: "threads",
      download_url: cobalt.data.url || null,
      picker: cobalt.data.picker || null,
    });
  }),
);

// ===== MediaFire direct link =====
router.get(
  "/mediafire",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const url = String(req.query.url || "").trim();
    if (!url) return fail(res, 400, "Missing ?url=");
    if (!/mediafire\.com/i.test(url)) {
      return fail(res, 400, "url must be a mediafire.com link");
    }
    const r = await axios.get(url, { headers: { "User-Agent": UA }, timeout: 20000 });
    const html = String(r.data || "");
    const direct = html.match(/href="(https?:\/\/download[^"]+)"/i)?.[1] || null;
    const filename =
      html.match(/<div class="filename">([^<]+)<\/div>/i)?.[1]?.trim() ||
      html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() ||
      null;
    const size = html.match(/<li>File size:\s*<\/li>\s*<li>([^<]+)<\/li>/i)?.[1]?.trim() || null;
    if (!direct) return fail(res, 502, "Could not extract direct link (page structure changed?)");
    logSuccess(req);
    return ok(res, { source: "mediafire", filename, size, download_url: direct });
  }),
);

// ===== YouTube search + play (mp3) — kasih query, dapet hasil & download_url =====
// Cara pakai: GET /api/downloader/play?q=mahalini+sisa+rasa
// 1. Search YouTube via piped/yt search HTML scrape (no API key)
// 2. Ambil video pertama, panggil cobalt buat mp3 download URL
const ytSearch = async (q) => {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  const r = await axios.get(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9",
    },
    timeout: 15000,
  });
  const html = String(r.data || "");
  const m = html.match(/var ytInitialData = ({[\s\S]*?});<\/script>/);
  if (!m) throw new Error("YouTube search page format changed");
  const data = JSON.parse(m[1]);
  // Flatten any nested videoRenderer objects under primaryContents — YouTube
  // changes structure occasionally (sectionListRenderer.contents > itemSectionRenderer.contents),
  // so walk recursively instead of relying on a fixed path.
  const items = [];
  const walk = (node) => {
    if (!node || typeof node !== "object" || items.length >= 10) return;
    if (node.videoRenderer?.videoId) {
      const v = node.videoRenderer;
      items.push({
        videoId: v.videoId,
        url: `https://www.youtube.com/watch?v=${v.videoId}`,
        title: v.title?.runs?.[0]?.text || null,
        duration: v.lengthText?.simpleText || null,
        channel:
          v.ownerText?.runs?.[0]?.text ||
          v.longBylineText?.runs?.[0]?.text ||
          null,
        views: v.viewCountText?.simpleText || v.shortViewCountText?.simpleText || null,
        published: v.publishedTimeText?.simpleText || null,
        thumbnail:
          v.thumbnail?.thumbnails?.[v.thumbnail.thumbnails.length - 1]?.url || null,
      });
      return;
    }
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
    } else {
      for (const k of Object.keys(node)) walk(node[k]);
    }
  };
  walk(data?.contents?.twoColumnSearchResultsRenderer?.primaryContents);
  return items;
};

router.get(
  "/play",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const q = String(req.query.q || req.query.query || "").trim();
    if (!q) return fail(res, 400, "Missing ?q= (judul lagu / keyword)");
    const results = await ytSearch(q);
    if (!results.length) return fail(res, 404, "No video found for query");
    const top = results[0];
    let download_url = null;
    let cobaltErr = null;
    try {
      const cobalt = await axios.post(
        "https://api.cobalt.tools/api/json",
        { url: top.url, isAudioOnly: true, aFormat: "mp3", filenamePattern: "basic" },
        {
          headers: {
            "User-Agent": UA,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          timeout: 30000,
        },
      );
      if (["stream", "redirect", "tunnel"].includes(cobalt.data?.status)) {
        download_url = cobalt.data.url;
      } else {
        cobaltErr = cobalt.data?.text || "cobalt status: " + cobalt.data?.status;
      }
    } catch (e) {
      cobaltErr = e.message;
    }
    logSuccess(req);
    return ok(res, {
      query: q,
      result: {
        ...top,
        format: "mp3",
        download_url,
        download_error: download_url ? null : cobaltErr,
      },
      related: results.slice(1, 6),
    });
  }),
);

// ===== YouTube search (return top 10 results without download URL) =====
router.get(
  "/ytsearch",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const q = String(req.query.q || req.query.query || "").trim();
    if (!q) return fail(res, 400, "Missing ?q=");
    const results = await ytSearch(q);
    if (!results.length) return fail(res, 404, "No video found for query");
    logSuccess(req);
    return ok(res, { query: q, total: results.length, results });
  }),
);

// ===== Spotify track metadata (via Spotify oEmbed — no auth required) =====
router.get(
  "/spotify",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const url = String(req.query.url || "").trim();
    if (!url) return fail(res, 400, "Missing ?url=");
    if (!/open\.spotify\.com/i.test(url)) {
      return fail(res, 400, "url must be an open.spotify.com link");
    }
    const r = await axios.get(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, {
      timeout: 15000,
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    const d = r.data || {};
    logSuccess(req);
    return ok(res, {
      type: d.type,
      title: d.title,
      author: d.provider_name,
      thumbnail: d.thumbnail_url,
      iframe_url: d.iframe_url || d.html?.match(/src="([^"]+)"/)?.[1] || null,
      note: "Spotify TOS forbids audio scraping. Only metadata is returned.",
    });
  }),
);

export default router;
