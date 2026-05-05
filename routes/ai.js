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

export default router;
