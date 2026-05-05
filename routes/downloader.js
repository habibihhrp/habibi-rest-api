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

// ===== YouTube downloader via Piped public instances =====
// Piped is a privacy-focused YouTube frontend that exposes a JSON API with direct
// (CDN-proxied) audio/video stream URLs. Cobalt v7 was the previous backend but
// shut down 2024-11-11 — Piped is the current working alternative.
//
// We try a list of known-good public Piped instances in order until one returns 200.
// You can override with PIPED_API_URL env var (set on Vercel). To self-host see
// https://github.com/TeamPiped/Piped.
const PIPED_INSTANCES = [
  process.env.PIPED_API_URL,
  "https://api.piped.private.coffee",
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
].filter(Boolean);

const extractYtVideoId = (url) => {
  const m =
    /(?:v=|\/shorts\/|youtu\.be\/|\/embed\/)([A-Za-z0-9_-]{11})/.exec(url) ||
    /^([A-Za-z0-9_-]{11})$/.exec(url);
  return m ? m[1] : null;
};

const pipedFetch = async (path) => {
  let lastErr = null;
  for (const base of PIPED_INSTANCES) {
    try {
      const r = await axios.get(`${base}${path}`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        timeout: 20000,
        maxRedirects: 3,
      });
      if (r.data && typeof r.data === "object") return r.data;
      lastErr = new Error("Non-JSON response from " + base);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("All Piped instances unreachable");
};

const pickBestAudio = (streams = []) =>
  [...streams].sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0)).pop();
const pickVideoByQuality = (streams = [], wantQ) => {
  if (!streams.length) return null;
  const exact = streams.find((s) => s.quality === wantQ + "p" && s.format === "MPEG_4");
  if (exact) return exact;
  const mp4 = streams.filter((s) => s.format === "MPEG_4");
  if (mp4.length) {
    return mp4.sort((a, b) => parseInt(a.quality) - parseInt(b.quality)).pop();
  }
  return streams[0];
};

const ytScraper = async (url) => {
  const id = extractYtVideoId(url);
  if (!id) throw new Error("Invalid YouTube URL or video id");
  const data = await pipedFetch(`/streams/${id}`);
  const audio = pickBestAudio(data.audioStreams);
  const video = pickVideoByQuality(data.videoStreams, "720");
  return {
    videoId: id,
    title: data.title || null,
    author: data.uploader || null,
    duration: data.duration || null,
    views: data.views || null,
    thumbnail: data.thumbnailUrl || null,
    audio_url: audio?.url || null,
    audio_bitrate: audio?.bitrate || null,
    audio_mime: audio?.mimeType || null,
    video_url: video?.url || null,
    video_quality: video?.quality || null,
    video_mime: video?.mimeType || null,
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
    const id = extractYtVideoId(url);
    if (!id) return fail(res, 400, "Invalid YouTube URL or video id");
    const data = await pipedFetch(`/streams/${id}`);
    const video = pickVideoByQuality(data.videoStreams, quality);
    if (!video?.url) return fail(res, 502, "No mp4 stream available for this video");
    logSuccess(req);
    return ok(res, {
      videoId: id,
      title: data.title || null,
      author: data.uploader || null,
      thumbnail: data.thumbnailUrl || null,
      quality: video.quality,
      format: "mp4",
      mime: video.mimeType,
      download_url: video.url,
    });
  }),
);

router.get(
  "/ytmp3",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const url = String(req.query.url || "").trim();
    if (!url) return fail(res, 400, "Missing ?url=");
    const id = extractYtVideoId(url);
    if (!id) return fail(res, 400, "Invalid YouTube URL or video id");
    const data = await pipedFetch(`/streams/${id}`);
    const audio = pickBestAudio(data.audioStreams);
    if (!audio?.url) return fail(res, 502, "No audio stream available for this video");
    logSuccess(req);
    return ok(res, {
      videoId: id,
      title: data.title || null,
      author: data.uploader || null,
      thumbnail: data.thumbnailUrl || null,
      format: "mp3",
      bitrate: audio.bitrate,
      mime: audio.mimeType,
      download_url: audio.url,
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
    let audio_url = null;
    let video_url = null;
    let bitrate = null;
    let dlErr = null;
    try {
      const data = await pipedFetch(`/streams/${top.videoId}`);
      const audio = pickBestAudio(data.audioStreams);
      const video = pickVideoByQuality(data.videoStreams, "720");
      if (audio?.url) {
        audio_url = audio.url;
        bitrate = audio.bitrate;
      }
      if (video?.url) {
        video_url = video.url;
      }
      if (!audio_url) dlErr = "No audio stream returned by Piped";
    } catch (e) {
      dlErr = e?.response?.data?.message || e?.message || "Piped fetch failed";
    }
    logSuccess(req);
    return ok(res, {
      query: q,
      result: {
        ...top,
        format: "mp3",
        audio_url,
        video_url,
        bitrate,
        download_url: audio_url,
        download_error: audio_url ? null : dlErr,
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
