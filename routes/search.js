// Search endpoints — GitHub, Wikipedia
import express from "express";
import axios from "axios";
import { apikeyAuth, logSuccess } from "../lib/auth.js";
import { ok, fail, tryCatch } from "../lib/respond.js";

const router = express.Router();

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

export default router;
