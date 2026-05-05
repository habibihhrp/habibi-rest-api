// Tools endpoints — brat, ssweb, qrcode, shorturl, base64, hash, ip-lookup, weather, color, nulis
import express from "express";
import axios from "axios";
import crypto from "crypto";
import QRCode from "qrcode";
import { apikeyAuth, logSuccess } from "../lib/auth.js";
import { ok, fail, tryCatch } from "../lib/respond.js";

const router = express.Router();
const UA =
  process.env.SCRAPER_UA ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

// ===== /api/tools/shorturl?url=... =====
// Uses is.gd public API (free, no auth, GDPR-friendly).
router.get(
  "/shorturl",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const url = String(req.query.url || "").trim();
    if (!url) return fail(res, 400, "Missing ?url=");
    if (!/^https?:\/\//i.test(url)) {
      return fail(res, 400, "url must start with http:// or https://");
    }
    const r = await axios.get("https://is.gd/create.php", {
      params: { format: "simple", url },
      timeout: 15000,
      headers: { "User-Agent": UA },
    });
    const short = String(r.data || "").trim();
    if (!short.startsWith("http")) {
      return fail(res, 502, `Shortener error: ${short}`);
    }
    logSuccess(req);
    return ok(res, { original: url, short });
  }),
);

// ===== /api/tools/base64?text=...&action=encode|decode =====
router.get(
  "/base64",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const text = String(req.query.text || "");
    const action = String(req.query.action || "encode").toLowerCase();
    if (!text) return fail(res, 400, "Missing ?text=");
    if (!["encode", "decode"].includes(action)) {
      return fail(res, 400, "action must be 'encode' or 'decode'");
    }
    let result;
    try {
      result =
        action === "encode"
          ? Buffer.from(text, "utf8").toString("base64")
          : Buffer.from(text, "base64").toString("utf8");
    } catch (e) {
      return fail(res, 400, `Invalid input for ${action}: ${e.message}`);
    }
    logSuccess(req);
    return ok(res, { action, input: text, result });
  }),
);

// ===== /api/tools/hash?text=...&algo=md5|sha1|sha256|sha512 =====
router.get(
  "/hash",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const text = String(req.query.text || "");
    const algo = String(req.query.algo || "md5").toLowerCase();
    if (!text) return fail(res, 400, "Missing ?text=");
    const allowed = ["md5", "sha1", "sha256", "sha512"];
    if (!allowed.includes(algo)) {
      return fail(res, 400, `algo must be one of: ${allowed.join(", ")}`);
    }
    const hash = crypto.createHash(algo).update(text, "utf8").digest("hex");
    logSuccess(req);
    return ok(res, { algo, input: text, hash });
  }),
);

// ===== /api/tools/iplookup?ip=8.8.8.8 =====
// Uses ip-api.com (free, no auth, ~45 req/min from any IP).
router.get(
  "/iplookup",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const ip = String(req.query.ip || req.ip || "").trim();
    if (!ip) return fail(res, 400, "Missing ?ip=");
    const r = await axios.get(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query`,
      { timeout: 15000, headers: { "User-Agent": UA, Accept: "application/json" } },
    );
    const d = r.data || {};
    if (d.status !== "success") return fail(res, 502, `ip-api error: ${d.message || "unknown"}`);
    logSuccess(req);
    return ok(res, {
      ip: d.query,
      city: d.city,
      region: d.regionName,
      country: d.country,
      country_code: d.countryCode,
      postal: d.zip,
      timezone: d.timezone,
      lat: d.lat,
      lon: d.lon,
      org: d.org || d.isp,
      asn: d.as,
    });
  }),
);

// ===== /api/tools/weather?city=Jakarta =====
// Uses wttr.in (free, no auth, structured JSON).
router.get(
  "/weather",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const city = String(req.query.city || "").trim();
    if (!city) return fail(res, 400, "Missing ?city=");
    const r = await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, {
      timeout: 20000,
      headers: { "User-Agent": "curl/7" }, // wttr.in returns JSON only for curl-style UA
    });
    const cur = r.data?.current_condition?.[0] || {};
    const area = r.data?.nearest_area?.[0] || {};
    logSuccess(req);
    return ok(res, {
      location: {
        city: area.areaName?.[0]?.value || city,
        region: area.region?.[0]?.value || null,
        country: area.country?.[0]?.value || null,
      },
      current: {
        temp_c: Number(cur.temp_C),
        temp_f: Number(cur.temp_F),
        feels_like_c: Number(cur.FeelsLikeC),
        humidity: Number(cur.humidity),
        wind_kph: Number(cur.windspeedKmph),
        wind_dir: cur.winddir16Point,
        cloud_cover: Number(cur.cloudcover),
        visibility_km: Number(cur.visibility),
        description: cur.weatherDesc?.[0]?.value || null,
        observation_time: cur.observation_time,
      },
    });
  }),
);

// ===== /api/tools/color?hex=ff0000 =====
// Returns RGB, HSL, complement, swatch PNG link.
router.get(
  "/color",
  apikeyAuth,
  tryCatch(async (req, res) => {
    let hex = String(req.query.hex || "").trim().replace(/^#/, "");
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
      return fail(res, 400, "hex must be 6-digit hex (e.g. ff0000 or #ff0000)");
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    // RGB -> HSL
    const rN = r / 255, gN = g / 255, bN = b / 255;
    const max = Math.max(rN, gN, bN), min = Math.min(rN, gN, bN);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === rN) h = ((gN - bN) / d + (gN < bN ? 6 : 0)) * 60;
      else if (max === gN) h = ((bN - rN) / d + 2) * 60;
      else h = ((rN - gN) / d + 4) * 60;
    }
    const compHex = ((0xffffff ^ parseInt(hex, 16)) >>> 0).toString(16).padStart(6, "0");
    logSuccess(req);
    return ok(res, {
      hex: `#${hex.toLowerCase()}`,
      rgb: { r, g, b },
      hsl: { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) },
      complement: `#${compHex}`,
      swatch: `https://singlecolorimage.com/get/${hex.toLowerCase()}/200x200.png`,
    });
  }),
);

// ===== /api/tools/nulis?text=... =====
// "Tulisan tangan" image — handwritten-style text on lined paper.
// Uses popcat.xyz nulis (free, no auth).
router.get(
  "/nulis",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const text = String(req.query.text || "").trim();
    if (!text) return fail(res, 400, "Missing ?text=");
    if (text.length > 500) return fail(res, 400, "text too long (max 500)");
    const upstream = `https://api.popcat.xyz/nulis?text=${encodeURIComponent(text)}`;
    try {
      const r = await axios.get(upstream, { responseType: "arraybuffer", timeout: 30000 });
      logSuccess(req);
      res.setHeader("Content-Type", "image/png");
      return res.send(Buffer.from(r.data));
    } catch (e) {
      return fail(res, 502, `Nulis upstream failed: ${e.message}`);
    }
  }),
);

// ===== /api/tools/uuid =====
// Generate a random UUID v4 (no params)
router.get(
  "/uuid",
  apikeyAuth,
  tryCatch(async (req, res) => {
    logSuccess(req);
    return ok(res, { uuid: crypto.randomUUID() });
  }),
);

// ===== /api/tools/password?length=16&symbols=true =====
// Generate a strong random password.
router.get(
  "/password",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const length = Math.min(Math.max(parseInt(req.query.length || "16", 10) || 16, 4), 128);
    const useSymbols = String(req.query.symbols || "true") !== "false";
    const lower = "abcdefghijklmnopqrstuvwxyz";
    const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const nums = "0123456789";
    const symbols = "!@#$%^&*()-_=+[]{};:,.<>?";
    const charset = lower + upper + nums + (useSymbols ? symbols : "");
    let password = "";
    const bytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
      password += charset[bytes[i] % charset.length];
    }
    logSuccess(req);
    return ok(res, { length, symbols: useSymbols, password });
  }),
);

// ===== /api/tools/iqc — IQC Generator (iOS WhatsApp long-press template) =====
// Generates an iOS-style "long-press a message" screenshot as SVG, dengan:
//   - Status bar iOS lengkap (signal bars, operator, jam, WiFi, battery + percentage)
//   - Background blurred (chat lain di-blur dim)
//   - Reaction emoji pill bar (👍 ❤️ 😂 😮 😢 🙏)
//   - Quoted message bubble (text + timestamp)
//   - Action sheet (Beri Bintang, Balas, Teruskan, Salin, Ucapkan, Laporkan, Hapus)
// Pure server-rendered SVG — no external deps.
const escapeXml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

router.get(
  "/iqc",
  apikeyAuth,
  tryCatch(async (req, res) => {
    const text = String(req.query.text || "").trim();
    if (!text) return fail(res, 400, "Missing ?text= (isi pesan)");
    if (text.length > 200) return fail(res, 400, "Text too long (max 200 chars)");

    const operator = String(req.query.operator || "Telkomsel").trim().slice(0, 16);
    const network = String(req.query.network || "LTE").trim().slice(0, 4).toUpperCase();
    const time = String(req.query.time || "07.58").trim().slice(0, 8);
    const battery = Math.min(100, Math.max(0, parseInt(req.query.battery || "28", 10) || 28));
    const signal = Math.min(4, Math.max(0, parseInt(req.query.signal || "4", 10) || 4));
    const wifi = String(req.query.wifi || "on").toLowerCase() !== "off";
    const wifiBars = Math.min(3, Math.max(0, parseInt(req.query.wifiBars || "3", 10) || 3));

    const W = 720;
    const padX = 24;
    const statusBarH = 60;

    // Status bar pieces (left: signal bars + operator + network; center: time; right: wifi + battery)
    const signalSvg = (() => {
      let s = "";
      for (let i = 0; i < 4; i++) {
        const filled = i < signal;
        const h = 6 + i * 4;
        const y = 26 - h;
        s += `<rect x="${padX + i * 8}" y="${y}" width="5" height="${h}" rx="1" fill="${filled ? "#fff" : "#666"}"/>`;
      }
      return s;
    })();

    const wifiSvg = (() => {
      if (!wifi) return "";
      const cx = W - 130;
      const cy = 30;
      const arc = (r, color) =>
        `<path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" stroke="${color}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
      return [
        arc(14, wifiBars >= 3 ? "#fff" : "#666"),
        arc(9, wifiBars >= 2 ? "#fff" : "#666"),
        arc(4, wifiBars >= 1 ? "#fff" : "#666"),
        `<circle cx="${cx}" cy="${cy + 4}" r="2.2" fill="#fff"/>`,
      ].join("");
    })();

    // Battery: percentage + box
    const battColor = battery <= 20 ? "#f5a300" : battery <= 10 ? "#ff3b30" : "#fff";
    const battFillW = (battery / 100) * 32;
    const batterySvg = `
      <text x="${W - 100}" y="38" font-size="20" fill="#fff" font-family="-apple-system, 'SF Pro Text', sans-serif" font-weight="500">${battery}%</text>
      <g transform="translate(${W - 60}, 22)">
        <rect x="0" y="0" width="36" height="16" rx="4" ry="4" fill="none" stroke="${battColor}" stroke-width="1.5"/>
        <rect x="36.5" y="5" width="2.5" height="6" rx="1" fill="${battColor}"/>
        <rect x="2" y="2" width="${battFillW}" height="12" rx="2" fill="${battColor}"/>
      </g>`;

    // Reaction bar pill — 6 emojis
    const reactions = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
    const reactX = padX + 30;
    const reactY = 360;
    const reactW = 480;
    const reactH = 64;
    const reactStep = reactW / reactions.length;
    const reactionSvg =
      `<rect x="${reactX}" y="${reactY}" width="${reactW}" height="${reactH}" rx="32" fill="#2a2a2a" fill-opacity="0.92"/>` +
      reactions
        .map((e, i) => `<text x="${reactX + i * reactStep + reactStep / 2}" y="${reactY + 44}" font-size="32" text-anchor="middle" font-family="'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif">${e}</text>`)
        .join("");

    // Quoted message bubble (the user's text, small grey bubble like WhatsApp)
    const bubbleX = padX + 16;
    const bubbleY = 460;
    const charW = 14;
    const minBubbleW = 110;
    const maxBubbleW = 380;
    const textWidth = Math.min(maxBubbleW, Math.max(minBubbleW, text.length * charW + 32));
    const bubbleH = 70;
    const quotedBubbleSvg = `
      <g>
        <rect x="${bubbleX}" y="${bubbleY}" width="${textWidth}" height="${bubbleH}" rx="14" fill="#2a2a2a" fill-opacity="0.95"/>
        <text x="${bubbleX + 16}" y="${bubbleY + 32}" font-size="22" fill="#fff" font-family="-apple-system, 'SF Pro Text', sans-serif">${escapeXml(text)}</text>
        <text x="${bubbleX + 16}" y="${bubbleY + 56}" font-size="14" fill="#9aa0a6" font-family="-apple-system, sans-serif">${escapeXml(time)}</text>
      </g>`;

    // Action sheet: 7 rows, white text + right-side icon, separators
    const actions = [
      { label: "Beri Bintang", icon: "star" },
      { label: "Balas", icon: "reply" },
      { label: "Teruskan", icon: "forward" },
      { label: "Salin", icon: "copy" },
      { label: "Ucapkan", icon: "speak" },
      { label: "Laporkan", icon: "warn" },
      { label: "Hapus", icon: "trash", danger: true },
    ];
    const sheetX = padX;
    const sheetY = 560;
    const sheetW = 480;
    const rowH = 64;
    const sheetH = actions.length * rowH;

    const iconSvg = (icon, x, y, color) => {
      // simple SF-Symbols-ish icon set, drawn with paths/rects
      const cx = x;
      const cy = y;
      switch (icon) {
        case "star":
          return `<path transform="translate(${cx - 14},${cy - 14})" d="M14 0 L17.4 9.6 L27.5 9.6 L19.5 15.5 L22.6 25 L14 19.4 L5.4 25 L8.5 15.5 L0.5 9.6 L10.6 9.6 Z" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
        case "reply":
          return `<path transform="translate(${cx - 14},${cy - 12})" d="M0 12 L10 4 L10 8 Q22 8 26 22 Q22 14 10 14 L10 20 Z" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
        case "forward":
          return `<path transform="translate(${cx - 14},${cy - 12})" d="M28 12 L18 4 L18 8 Q6 8 2 22 Q6 14 18 14 L18 20 Z" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
        case "copy":
          return `<g transform="translate(${cx - 12},${cy - 14})" stroke="${color}" stroke-width="2" fill="none">
                    <rect x="0" y="6" width="18" height="22" rx="3"/>
                    <rect x="6" y="0" width="18" height="22" rx="3"/>
                  </g>`;
        case "speak":
          return `<g transform="translate(${cx - 14},${cy - 12})" stroke="${color}" stroke-width="2" fill="none" stroke-linejoin="round">
                    <path d="M2 8 L9 8 L17 2 L17 22 L9 16 L2 16 Z"/>
                    <path d="M21 8 Q25 12 21 16" stroke-linecap="round"/>
                  </g>`;
        case "warn":
          return `<g transform="translate(${cx - 14},${cy - 13})" stroke="${color}" stroke-width="2" fill="none" stroke-linejoin="round">
                    <path d="M14 0 L28 24 L0 24 Z"/>
                    <line x1="14" y1="9" x2="14" y2="16" stroke-linecap="round"/>
                    <circle cx="14" cy="20" r="0.8" fill="${color}" stroke="none"/>
                  </g>`;
        case "trash":
          return `<g transform="translate(${cx - 12},${cy - 13})" stroke="${color}" stroke-width="2" fill="none" stroke-linejoin="round">
                    <path d="M2 5 L22 5"/>
                    <path d="M9 5 L9 1 L15 1 L15 5"/>
                    <path d="M4 5 L5 24 L19 24 L20 5 Z"/>
                    <line x1="9" y1="10" x2="9" y2="20"/>
                    <line x1="15" y1="10" x2="15" y2="20"/>
                  </g>`;
      }
      return "";
    };

    const sheetRowsSvg = actions
      .map((a, i) => {
        const y = sheetY + i * rowH;
        const color = a.danger ? "#ff3b30" : "#fff";
        const iconX = sheetX + sheetW - 36;
        const iconY = y + rowH / 2;
        const sep = i > 0 ? `<line x1="${sheetX + 24}" y1="${y}" x2="${sheetX + sheetW - 24}" y2="${y}" stroke="#3a3a3a" stroke-width="1"/>` : "";
        return (
          sep +
          `<text x="${sheetX + 32}" y="${y + rowH / 2 + 9}" font-size="26" fill="${color}" font-family="-apple-system, 'SF Pro Text', sans-serif" font-weight="500">${escapeXml(a.label)}</text>` +
          iconSvg(a.icon, iconX, iconY, color)
        );
      })
      .join("");

    // Background — blurred dark with subtle whatsapp-bubble shapes (greenish dim, message-list-like layout)
    const bgBlurSvg = `
      <defs>
        <filter id="iqcblur"><feGaussianBlur stdDeviation="14"/></filter>
      </defs>
      <g filter="url(#iqcblur)" opacity="0.5">
        <!-- received bubbles (left, dark green) -->
        <rect x="40" y="120" width="200" height="34" rx="14" fill="#005c4b"/>
        <rect x="40" y="160" width="160" height="30" rx="14" fill="#005c4b"/>
        <!-- sent bubbles (right, lighter green) -->
        <rect x="${W - 240}" y="200" width="200" height="34" rx="14" fill="#0b7d63"/>
        <rect x="${W - 220}" y="240" width="180" height="30" rx="14" fill="#0b7d63"/>
        <rect x="${W - 260}" y="280" width="220" height="30" rx="14" fill="#0b7d63"/>
        <rect x="${W - 200}" y="320" width="160" height="34" rx="14" fill="#0b7d63"/>
        <!-- avatar circle -->
        <circle cx="60" cy="115" r="22" fill="#9aa0a6"/>
      </g>`;

    const H = sheetY + sheetH + 40;

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <!-- backdrop -->
  <rect width="100%" height="100%" fill="#000"/>
  ${bgBlurSvg}
  <!-- semi-transparent dim over background -->
  <rect x="0" y="${statusBarH + 10}" width="${W}" height="${H - statusBarH - 10}" fill="#000" fill-opacity="0.55"/>
  <!-- ===== status bar ===== -->
  <g font-family="-apple-system, 'SF Pro Text', sans-serif">
    ${signalSvg}
    <text x="${padX + 38}" y="38" font-size="20" fill="#fff" font-weight="600">${escapeXml(operator)}</text>
    <text x="${padX + 38 + (operator.length * 11) + 14}" y="38" font-size="20" fill="#fff" font-weight="500">${escapeXml(network)}</text>
    <text x="${W / 2}" y="38" font-size="22" fill="#fff" font-weight="600" text-anchor="middle">${escapeXml(time)}</text>
    ${wifiSvg}
    ${batterySvg}
  </g>
  <!-- reaction pill -->
  ${reactionSvg}
  <!-- quoted message bubble -->
  ${quotedBubbleSvg}
  <!-- action sheet -->
  <g>
    <rect x="${sheetX}" y="${sheetY}" width="${sheetW}" height="${sheetH}" rx="20" fill="#1c1c1e" fill-opacity="0.96"/>
    ${sheetRowsSvg}
  </g>
</svg>`;
    logSuccess(req);
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.send(svg);
  }),
);

export default router;
