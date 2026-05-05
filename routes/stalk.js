// Stalk endpoints — github user, ig user, tiktok user
import express from "express";
import axios from "axios";
import { apikeyAuth, logSuccess } from "../lib/auth.js";
import { ok, fail, tryCatch } from "../lib/respond.js";

const router = express.Router();
const UA =
  process.env.SCRAPER_UA ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// GET /api/stalk/github?username=octocat
router.get(
  "/github",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const username = String(req.query.username || "").trim();
    if (!username) return fail(res, 400, "Missing ?username=");
    const r = await axios.get(`https://api.github.com/users/${encodeURIComponent(username)}`, {
      timeout: 15000,
      headers: { "User-Agent": UA, Accept: "application/vnd.github+json" },
    });
    const d = r.data || {};
    logSuccess(req);
    return ok(res, {
      login: d.login,
      name: d.name,
      bio: d.bio,
      avatar: d.avatar_url,
      url: d.html_url,
      company: d.company,
      blog: d.blog,
      location: d.location,
      twitter: d.twitter_username,
      followers: d.followers,
      following: d.following,
      public_repos: d.public_repos,
      created_at: d.created_at,
    });
  }),
);

// GET /api/stalk/tiktok?username=charlidamelio
// Uses tikwm public API.
router.get(
  "/tiktok",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const username = String(req.query.username || "").trim().replace(/^@/, "");
    if (!username) return fail(res, 400, "Missing ?username=");
    const r = await axios.post(
      "https://www.tikwm.com/api/user/info",
      new URLSearchParams({ unique_id: username }),
      {
        timeout: 20000,
        headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
      },
    );
    if (r.data?.code !== 0) return fail(res, 502, r.data?.msg || "TikTok stalk failed");
    const u = r.data.data?.user || {};
    const stats = r.data.data?.stats || {};
    logSuccess(req);
    return ok(res, {
      username: u.unique_id,
      nickname: u.nickname,
      bio: u.signature,
      avatar: u.avatar,
      verified: !!u.verified,
      private: !!u.privateAccount,
      stats: {
        followers: stats.followerCount,
        following: stats.followingCount,
        likes: stats.heartCount,
        videos: stats.videoCount,
      },
    });
  }),
);

// GET /api/stalk/instagram?username=cristiano
// Uses the public web profile JSON endpoint (best-effort, IG often blocks).
router.get(
  "/instagram",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const username = String(req.query.username || "").trim().replace(/^@/, "");
    if (!username) return fail(res, 400, "Missing ?username=");
    try {
      const r = await axios.get(
        `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
        {
          timeout: 20000,
          headers: {
            "User-Agent": "Instagram 76.0.0.15.395 Android",
            "X-IG-App-ID": "936619743392459",
            Accept: "application/json",
          },
        },
      );
      const u = r.data?.data?.user;
      if (!u) return fail(res, 404, "User not found");
      logSuccess(req);
      return ok(res, {
        username: u.username,
        full_name: u.full_name,
        bio: u.biography,
        avatar: u.profile_pic_url_hd || u.profile_pic_url,
        verified: !!u.is_verified,
        private: !!u.is_private,
        stats: {
          followers: u.edge_followed_by?.count,
          following: u.edge_follow?.count,
          posts: u.edge_owner_to_timeline_media?.count,
        },
        external_url: u.external_url,
      });
    } catch (e) {
      return fail(
        res,
        502,
        `Instagram blocked the request: ${e.message}. Coba lagi nanti — IG sering rate-limit.`,
      );
    }
  }),
);

export default router;
