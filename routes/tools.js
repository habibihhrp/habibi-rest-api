// Tools endpoints — brat, ssweb (screenshot), qrcode
import express from "express";
import axios from "axios";
import QRCode from "qrcode";
import { apikeyAuth, logSuccess } from "../lib/auth.js";
import { ok, fail, tryCatch } from "../lib/respond.js";

const router = express.Router();

// ===== /api/tools/brat?text=... =====
// Brat-style sticker (white text on black bg, blurred). Proxy ke
// public api.popcat.xyz (they host the renderer). Returns PNG image.
router.get(
  "/brat",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const text = String(req.query.text || "").trim();
    if (!text) return fail(res, 400, "Missing ?text=");
    if (text.length > 200) return fail(res, 400, "Text too long (max 200 chars)");

    const upstream = `https://aqul-brat.hf.space/api/brat?text=${encodeURIComponent(text)}`;
    try {
      const r = await axios.get(upstream, { responseType: "arraybuffer", timeout: 20000 });
      logSuccess(req);
      res.setHeader("Content-Type", "image/png");
      return res.send(Buffer.from(r.data));
    } catch (e) {
      return fail(res, 502, `Brat upstream failed: ${e.message}`);
    }
  }),
);

// ===== /api/tools/ssweb?url=... =====
// Take screenshot of a website. Uses image.thum.io (free, no auth).
router.get(
  "/ssweb",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const url = String(req.query.url || "").trim();
    if (!url) return fail(res, 400, "Missing ?url=");
    if (!/^https?:\/\//i.test(url)) {
      return fail(res, 400, "url must start with http:// or https://");
    }
    const upstream = `https://image.thum.io/get/width/1200/crop/1500/${encodeURIComponent(url)}`;
    try {
      const r = await axios.get(upstream, { responseType: "arraybuffer", timeout: 30000 });
      logSuccess(req);
      res.setHeader("Content-Type", "image/jpeg");
      return res.send(Buffer.from(r.data));
    } catch (e) {
      return fail(res, 502, `Screenshot failed: ${e.message}`);
    }
  }),
);

// ===== /api/tools/qrcode?text=... =====
// Generate QR code PNG. Uses local `qrcode` lib (no external dep).
router.get(
  "/qrcode",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const text = String(req.query.text || "").trim();
    if (!text) return fail(res, 400, "Missing ?text=");
    if (text.length > 1000) return fail(res, 400, "Text too long (max 1000)");

    const buffer = await QRCode.toBuffer(text, {
      type: "png",
      errorCorrectionLevel: "M",
      width: 512,
      margin: 2,
      color: { dark: "#000000", light: "#FFFFFF" },
    });
    logSuccess(req);
    res.setHeader("Content-Type", "image/png");
    return res.send(buffer);
  }),
);

export default router;
