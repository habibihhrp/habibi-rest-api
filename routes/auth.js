// Auth routes — register, login, me, rotate-apikey
import express from "express";
import bcrypt from "bcryptjs";
import { users, apikeys, logs } from "../lib/db.js";
import {
  generateApikey,
  signJwt,
  jwtAuth,
} from "../lib/auth.js";
import { ok, fail, tryCatch } from "../lib/respond.js";

const router = express.Router();

const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || "").toLowerCase().trim();

// POST /api/auth/register
// body: { username, email, password }
router.post(
  "/register",
  tryCatch(async (req, res) => {
    const { username, email, password } = req.body || {};
    if (!username || !email || !password) {
      return fail(res, 400, "username, email, password required");
    }
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
      return fail(res, 400, "username must be 3-32 chars (alnum or _)");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail(res, 400, "invalid email");
    }
    if (password.length < 6) {
      return fail(res, 400, "password min 6 chars");
    }

    if (await users.byUsername(username)) {
      return fail(res, 409, "username taken");
    }
    if (await users.byEmail(email)) {
      return fail(res, 409, "email already registered");
    }

    const password_hash = await bcrypt.hash(password, 10);

    // First user OR matching ADMIN_USERNAME → admin role
    const totalUsers = await users.count();
    const isAdmin =
      totalUsers === 0 ||
      (ADMIN_USERNAME && username.toLowerCase() === ADMIN_USERNAME);
    const role = isAdmin ? "admin" : "user";

    const userId = await users.create({
      username,
      email,
      password_hash,
      role,
    });

    const apikey = generateApikey();
    await apikeys.create({ user_id: userId, apikey, plan: "free" });

    const token = signJwt({ id: userId, username, role });
    return ok(res, {
      token,
      user: { id: userId, username, email, role },
      apikey,
      plan: "free",
    });
  }),
);

// POST /api/auth/login
// body: { username, password }
router.post(
  "/login",
  tryCatch(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return fail(res, 400, "username and password required");
    }
    const user = await users.byUsername(username);
    if (!user) return fail(res, 401, "invalid credentials");

    const okPass = await bcrypt.compare(password, user.password_hash);
    if (!okPass) return fail(res, 401, "invalid credentials");

    const apikey = await apikeys.getByUserId(user.id);
    const token = signJwt({
      id: user.id,
      username: user.username,
      role: user.role,
    });
    return ok(res, {
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
      apikey: apikey?.apikey || null,
      plan: apikey?.plan || "free",
    });
  }),
);

// GET /api/auth/me — returns user + apikey + usage
router.get(
  "/me",
  jwtAuth,
  tryCatch(async (req, res) => {
    const apikey = await apikeys.getByUserId(req.user.id);
    if (apikey) await apikeys.resetIfNewDay(apikey);
    const recent = apikey ? await logs.recentByApikey(apikey.apikey) : [];
    return ok(res, {
      user: {
        id: req.user.id,
        username: req.user.username,
        email: req.user.email,
        role: req.user.role,
      },
      apikey: apikey?.apikey || null,
      plan: apikey?.plan || "free",
      used_today: Number(apikey?.used_today || 0),
      expiry: apikey?.expiry ? Number(apikey.expiry) : null,
      recent_logs: recent.map((r) => ({
        endpoint: r.endpoint,
        status: r.status,
        timestamp: Number(r.timestamp),
      })),
    });
  }),
);

// POST /api/auth/rotate-apikey — generate baru, invalidate yg lama
router.post(
  "/rotate-apikey",
  jwtAuth,
  tryCatch(async (req, res) => {
    const newKey = generateApikey();
    await apikeys.rotate(req.user.id, newKey);
    return ok(res, { apikey: newKey });
  }),
);

export default router;
