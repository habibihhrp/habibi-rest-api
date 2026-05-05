// JWT + apikey auth helpers + middlewares (async — Turso/libSQL)
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { users, apikeys, logs } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-secret-change-me-please";
const LIMIT_FREE = parseInt(process.env.LIMIT_FREE || "100", 10);
const LIMIT_PREMIUM = parseInt(process.env.LIMIT_PREMIUM || "999999", 10);

// 32-char hex apikey (≈128 bits entropy)
export const generateApikey = () => crypto.randomBytes(16).toString("hex");

// JWT for dashboard session (7-day expiry)
export const signJwt = (payload) =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });

export const verifyJwt = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
};

export const limitFor = (plan) =>
  plan === "premium" ? LIMIT_PREMIUM : LIMIT_FREE;

// ===== Middleware: API key auth =====
// Accepts apikey from query (?apikey=) or header (X-API-Key).
// On success: req.apikey = row, req.user = user row.
// Increments used_today. Resets daily at 00:00 WIB.
// Logs request to db (best-effort, non-blocking).
export const apikeyAuth = async (req, res, next) => {
  const key =
    req.query.apikey ||
    req.headers["x-api-key"] ||
    req.headers["apikey"];

  const endpoint = req.originalUrl.split("?")[0];

  if (!key) {
    logs.insert({ apikey: null, endpoint, status: 401, ip: req.ip }).catch(() => {});
    return res.status(401).json({
      status: false,
      code: 401,
      message: "API key required. Pass ?apikey=xxx or X-API-Key header.",
    });
  }

  let row;
  try {
    row = await apikeys.get(key);
  } catch (e) {
    return res.status(500).json({ status: false, code: 500, message: "DB error" });
  }

  if (!row) {
    logs.insert({ apikey: key, endpoint, status: 401, ip: req.ip }).catch(() => {});
    return res.status(401).json({ status: false, code: 401, message: "Invalid API key." });
  }

  if (row.expiry && Number(row.expiry) < Date.now()) {
    return res.status(403).json({
      status: false,
      code: 403,
      message: "API key expired. Renew or upgrade plan.",
    });
  }

  // Daily reset (mutates row)
  row = await apikeys.resetIfNewDay(row);

  const limit = limitFor(row.plan);
  const used = Number(row.used_today);
  if (used >= limit) {
    logs.insert({ apikey: key, endpoint, status: 429, ip: req.ip }).catch(() => {});
    return res.status(429).json({
      status: false,
      code: 429,
      message: `Daily limit exceeded (${limit}/day). Reset at 00:00 WIB.`,
      plan: row.plan,
      used_today: used,
      limit,
    });
  }

  // Fire-and-forget increment + log (don't block response)
  apikeys.incrementUsage(row.id).catch(() => {});
  const user = await users.byId(row.user_id);
  req.apikey = row;
  req.user = user;
  next();
};

// ===== Middleware: JWT auth (for dashboard endpoints) =====
export const jwtAuth = async (req, res, next) => {
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    return res.status(401).json({ status: false, message: "Unauthorized" });
  }
  const decoded = verifyJwt(token);
  if (!decoded) {
    return res.status(401).json({ status: false, message: "Invalid token" });
  }
  const user = await users.byId(decoded.id);
  if (!user) {
    return res.status(401).json({ status: false, message: "User not found" });
  }
  req.user = user;
  next();
};

// ===== Middleware: admin only (chain after jwtAuth) =====
export const adminOnly = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ status: false, message: "Admin only" });
  }
  next();
};

// ===== Helper: log success after endpoint handler =====
export const logSuccess = (req) => {
  logs
    .insert({
      apikey: req.apikey?.apikey || null,
      endpoint: req.originalUrl.split("?")[0],
      status: 200,
      ip: req.ip,
    })
    .catch(() => {});
};
