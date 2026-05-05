// AI chat endpoint — proxy ke Groq (free tier).
// Daftar di https://console.groq.com untuk dapet GROQ_API_KEY (gratis).
// Default model: llama-3.3-70b-versatile (super fast).
import express from "express";
import axios from "axios";
import { apikeyAuth, logSuccess } from "../lib/auth.js";
import { ok, fail, tryCatch } from "../lib/respond.js";

const router = express.Router();

const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

// GET /api/ai/chat?prompt=...
// Optional: ?system=... (custom system prompt), ?model=... (override default)
router.get(
  "/chat",
  apikeyAuth,
  tryCatch(async (req, res) => {
    if (!GROQ_API_KEY) {
      return fail(
        res,
        503,
        "AI endpoint disabled. Set GROQ_API_KEY in .env (free at console.groq.com)",
      );
    }
    const prompt = String(req.query.prompt || "").trim();
    if (!prompt) return fail(res, 400, "Missing ?prompt=");
    const system =
      String(req.query.system || "").trim() ||
      "You are a helpful Indonesian-speaking assistant. Answer concisely.";
    const model = String(req.query.model || "").trim() || GROQ_MODEL;

    const r = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 1024,
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      },
    );

    const answer = r.data?.choices?.[0]?.message?.content || "";
    const usage = r.data?.usage || null;
    logSuccess(req);
    return ok(res, { model, answer, usage });
  }),
);

// ===== /api/ai/gemini =====
// Google Gemini (free tier ~60 req/min). Set GEMINI_API_KEY in env.
// Daftar gratis di https://aistudio.google.com/app/apikey
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
router.get(
  "/gemini",
  apikeyAuth,
  tryCatch(async (req, res) => {
    if (!GEMINI_API_KEY) {
      return fail(res, 503, "Gemini disabled. Set GEMINI_API_KEY (free at aistudio.google.com).");
    }
    const prompt = String(req.query.prompt || "").trim();
    if (!prompt) return fail(res, 400, "Missing ?prompt=");
    const model = String(req.query.model || "").trim() || GEMINI_MODEL;
    const r = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      { contents: [{ parts: [{ text: prompt }] }] },
      { headers: { "Content-Type": "application/json" }, timeout: 30000 },
    );
    const answer = r.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    logSuccess(req);
    return ok(res, { model, answer });
  }),
);

// ===== /api/ai/imagine =====
// Free image generation via Pollinations (no auth required).
// Returns PNG bytes directly. ?prompt=... &width=&height=
router.get(
  "/imagine",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const prompt = String(req.query.prompt || "").trim();
    if (!prompt) return fail(res, 400, "Missing ?prompt=");
    const width = Math.min(Math.max(parseInt(req.query.width || "768", 10) || 768, 256), 1536);
    const height = Math.min(Math.max(parseInt(req.query.height || "768", 10) || 768, 256), 1536);
    const seed = req.query.seed ? `&seed=${encodeURIComponent(String(req.query.seed))}` : "";
    const upstream = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true${seed}`;
    try {
      const r = await axios.get(upstream, { responseType: "arraybuffer", timeout: 60000 });
      logSuccess(req);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("X-Image-Source", "pollinations");
      return res.send(Buffer.from(r.data));
    } catch (e) {
      return fail(res, 502, `Image generation failed: ${e.message}`);
    }
  }),
);

// ===== /api/ai/tts =====
// Text-to-speech via Google Translate TTS (free, no auth). Returns mp3 audio bytes.
// ?text=halo&lang=id  (lang: id|en|jp|... ISO 639-1)
router.get(
  "/tts",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const text = String(req.query.text || "").trim();
    if (!text) return fail(res, 400, "Missing ?text=");
    if (text.length > 500) return fail(res, 400, "text too long (max 500)");
    const lang = String(req.query.lang || "id").trim();
    // Google Translate TTS (informal but reliable). Single-segment max ~200 chars.
    const upstream = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(lang)}&client=tw-ob&q=${encodeURIComponent(text)}`;
    try {
      const r = await axios.get(upstream, {
        responseType: "arraybuffer",
        timeout: 30000,
        headers: { "User-Agent": "Mozilla/5.0", Referer: "https://translate.google.com/" },
      });
      logSuccess(req);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("X-Lang", lang);
      return res.send(Buffer.from(r.data));
    } catch (e) {
      return fail(res, 502, `TTS upstream failed: ${e.message}`);
    }
  }),
);

// ===== /api/ai/translate =====
// Google Translate web API (no key). ?text=halo&from=auto&to=en
router.get(
  "/translate",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const text = String(req.query.text || "").trim();
    if (!text) return fail(res, 400, "Missing ?text=");
    if (text.length > 5000) return fail(res, 400, "text too long (max 5000)");
    const from = String(req.query.from || "auto").trim();
    const to = String(req.query.to || "en").trim();
    const upstream = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`;
    const r = await axios.get(upstream, { timeout: 15000 });
    const segments = (r.data?.[0] || []).map((s) => s[0]).filter(Boolean);
    const detected = r.data?.[2] || from;
    logSuccess(req);
    return ok(res, {
      from: detected,
      to,
      original: text,
      translated: segments.join(""),
    });
  }),
);

export default router;
