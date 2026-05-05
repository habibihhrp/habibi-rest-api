// Search endpoints — GitHub, Wikipedia, lirik, KBBI, npm, pinterest, tiktok-search
import express from "express";
import axios from "axios";
import { apikeyAuth, logSuccess } from "../lib/auth.js";
import { ok, fail, tryCatch } from "../lib/respond.js";

const router = express.Router();
const UA =
  process.env.SCRAPER_UA ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// GET /api/search/github?q=...
router.get(
  "/github",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q) return fail(res, 400, "Missing ?q=");
    const r = await axios.get("https://api.github.com/search/repositories", {
      params: { q, per_page: 10, sort: "stars" },
      headers: { Accept: "application/vnd.github+json" },
      timeout: 15000,
    });
    const items = (r.data?.items || []).map((it) => ({
      name: it.full_name,
      url: it.html_url,
      description: it.description,
      stars: it.stargazers_count,
      forks: it.forks_count,
      language: it.language,
      owner: it.owner?.login,
      avatar: it.owner?.avatar_url,
    }));
    logSuccess(req);
    return ok(res, { total: r.data?.total_count || 0, items });
  }),
);

// GET /api/search/wikipedia?q=...&lang=id
router.get(
  "/wikipedia",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const q = String(req.query.q || "").trim();
    const lang = String(req.query.lang || "id").trim().slice(0, 5);
    if (!q) return fail(res, 400, "Missing ?q=");
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`;
    const r = await axios.get(url, {
      timeout: 15000,
      headers: {
        // Wikipedia REST API requires a non-default User-Agent.
        "User-Agent": "habibi-rest-api/1.0 (https://github.com/habibihhrp; admin@example.com)",
        Accept: "application/json",
      },
    });
    logSuccess(req);
    return ok(res, {
      title: r.data?.title,
      description: r.data?.description,
      extract: r.data?.extract,
      thumbnail: r.data?.thumbnail?.source || null,
      url: r.data?.content_urls?.desktop?.page || null,
    });
  }),
);

// ===== /api/search/npm?q=... =====
// Search npm registry (no auth required).
router.get(
  "/npm",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q) return fail(res, 400, "Missing ?q=");
    const r = await axios.get("https://registry.npmjs.org/-/v1/search", {
      params: { text: q, size: 10 },
      timeout: 15000,
    });
    const items = (r.data?.objects || []).map((it) => ({
      name: it.package?.name,
      version: it.package?.version,
      description: it.package?.description,
      author: it.package?.author?.name || it.package?.publisher?.username,
      keywords: it.package?.keywords || [],
      url: it.package?.links?.npm,
      repository: it.package?.links?.repository,
      score: it.score?.final,
    }));
    logSuccess(req);
    return ok(res, { total: r.data?.total || 0, items });
  }),
);

// ===== /api/search/lirik?q=judul lagu =====
// Lyrics search via lyrics.ovh (free, no auth) — fallback ke some.random.api.
router.get(
  "/lirik",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q) return fail(res, 400, "Missing ?q= (format: 'penyanyi - judul' atau 'judul')");
    const parts = q.split("-").map((s) => s.trim()).filter(Boolean);
    let artist = "", title = q;
    if (parts.length >= 2) {
      artist = parts[0];
      title = parts.slice(1).join(" - ");
    }
    // Try lyrics.ovh (works best with artist+title)
    if (artist) {
      try {
        const r = await axios.get(
          `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
          { timeout: 15000 },
        );
        if (r.data?.lyrics) {
          logSuccess(req);
          return ok(res, { artist, title, lyrics: r.data.lyrics });
        }
      } catch {
        // fall through
      }
    }
    return fail(res, 404, "Lirik tidak ditemukan. Coba format: 'penyanyi - judul'.");
  }),
);

// ===== /api/search/kbbi?q=kata =====
// Indonesian dictionary via id.wiktionary.org parse API.
// Parses the rendered HTML and extracts the first <ol> definitions list under
// the "Bahasa Indonesia" section. Best-effort — Wiktionary entries vary.
router.get(
  "/kbbi",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const q = String(req.query.q || "").trim().toLowerCase();
    if (!q) return fail(res, 400, "Missing ?q=");
    const r = await axios.get("https://id.wiktionary.org/w/api.php", {
      params: { action: "parse", page: q, format: "json", prop: "text", redirects: 1 },
      timeout: 15000,
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (r.data?.error) {
      return fail(res, 404, `Kata "${q}" tidak ditemukan di Wiktionary ID`);
    }
    const html = String(r.data?.parse?.text?.["*"] || "");
    if (!html) return fail(res, 404, `Tidak ada konten untuk kata "${q}"`);

    // Extract Bahasa Indonesia section HTML
    const idMatch = html.match(/Bahasa_Indonesia[\s\S]*?(?=mw-heading2|$)/);
    const section = idMatch ? idMatch[0] : html;

    // Extract definitions: pull all <li>...</li> from the first <ol>
    const olMatch = section.match(/<ol>([\s\S]*?)<\/ol>/);
    const liItems = olMatch ? Array.from(olMatch[1].matchAll(/<li>([\s\S]*?)<\/li>/g)) : [];
    const definitions = liItems
      .map((m) => m[1].replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, " ").trim())
      .filter(Boolean);

    if (definitions.length === 0) {
      return fail(res, 404, `Tidak ada definisi Bahasa Indonesia untuk "${q}"`);
    }
    logSuccess(req);
    return ok(res, {
      kata: q,
      sumber: "id.wiktionary.org",
      url: `https://id.wiktionary.org/wiki/${encodeURIComponent(q)}`,
      definitions,
    });
  }),
);

// ===== /api/search/pinterest?q=... =====
// Public scraper (best-effort) using rest pinterest's public search HTML.
router.get(
  "/pinterest",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q) return fail(res, 400, "Missing ?q=");
    const r = await axios.get(
      `https://www.pinterest.com/resource/BaseSearchResource/get/?source_url=/search/pins/?q=${encodeURIComponent(q)}&data=${encodeURIComponent(
        JSON.stringify({ options: { query: q, scope: "pins", page_size: 12 } }),
      )}`,
      {
        timeout: 20000,
        headers: { "User-Agent": UA, Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
      },
    );
    const results = r.data?.resource_response?.data?.results || [];
    const items = results
      .map((p) => p?.images?.orig?.url || p?.images?.["474x"]?.url)
      .filter(Boolean)
      .slice(0, 12);
    if (items.length === 0) {
      return fail(res, 502, "Pinterest scrape returned no results (rate-limited or blocked)");
    }
    logSuccess(req);
    return ok(res, { query: q, count: items.length, images: items });
  }),
);

// ===== /api/search/tiktok?q=... =====
// Tiktok search via tikwm public API.
router.get(
  "/tiktok",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q) return fail(res, 400, "Missing ?q=");
    const r = await axios.post(
      "https://www.tikwm.com/api/feed/search",
      new URLSearchParams({ keywords: q, count: "10", cursor: "0", HD: "1" }),
      {
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 20000,
      },
    );
    if (r.data?.code !== 0) return fail(res, 502, r.data?.msg || "TikTok search failed");
    const items = (r.data.data?.videos || []).map((v) => ({
      id: v.video_id,
      title: v.title,
      author: { name: v.author?.nickname, username: v.author?.unique_id },
      duration: v.duration,
      cover: v.cover,
      play: v.play,
      stats: { play: v.play_count, digg: v.digg_count, share: v.share_count },
    }));
    logSuccess(req);
    return ok(res, { query: q, count: items.length, items });
  }),
);

// ===== /api/search/google?q=... =====
// DuckDuckGo HTML scrape (no auth, but rate-limited).
router.get(
  "/google",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q) return fail(res, 400, "Missing ?q=");
    const r = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
      timeout: 20000,
      headers: { "User-Agent": UA },
    });
    const html = String(r.data || "");
    const items = [];
    const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) && items.length < 10) {
      const url = m[1].replace(/^.*?uddg=/, "").replace(/&rut=.*$/, "");
      items.push({
        title: m[2].replace(/<[^>]+>/g, "").trim(),
        url: decodeURIComponent(url),
        snippet: m[3].replace(/<[^>]+>/g, "").trim(),
      });
    }
    if (items.length === 0) {
      return fail(res, 502, "Search returned no results (upstream may be blocking)");
    }
    logSuccess(req);
    return ok(res, { query: q, count: items.length, items });
  }),
);

export default router;
