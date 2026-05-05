// Admin routes — list users, upgrade plan, set role
import express from "express";
import { users, apikeys } from "../lib/db.js";
import { jwtAuth, adminOnly } from "../lib/auth.js";
import { ok, fail, tryCatch } from "../lib/respond.js";

const router = express.Router();

router.use(jwtAuth, adminOnly);

// GET /api/admin/users — list all users with apikey + plan
router.get(
  "/users",
  tryCatch(async (req, res) => {
    const list = await users.list();
    return ok(
      res,
      list.map((u) => ({
        id: Number(u.id),
        username: u.username,
        email: u.email,
        role: u.role,
        created_at: Number(u.created_at),
        apikey: u.apikey || null,
        plan: u.plan || null,
        used_today: Number(u.used_today || 0),
        expiry: u.expiry ? Number(u.expiry) : null,
      })),
    );
  }),
);

// POST /api/admin/upgrade
// body: { user_id, plan: "free"|"premium", days?: number }
router.post(
  "/upgrade",
  tryCatch(async (req, res) => {
    const { user_id, plan, days } = req.body || {};
    if (!user_id || !["free", "premium"].includes(plan)) {
      return fail(res, 400, "user_id and plan ('free'|'premium') required");
    }
    const expiry =
      plan === "premium" && days
        ? Date.now() + Number(days) * 86400 * 1000
        : null;
    await apikeys.updatePlan(user_id, plan, expiry);
    return ok(res, { user_id, plan, expiry });
  }),
);

// POST /api/admin/set-role
// body: { user_id, role: "user"|"admin" }
router.post(
  "/set-role",
  tryCatch(async (req, res) => {
    const { user_id, role } = req.body || {};
    if (!user_id || !["user", "admin"].includes(role)) {
      return fail(res, 400, "user_id and role ('user'|'admin') required");
    }
    await users.setRole(user_id, role);
    return ok(res, { user_id, role });
  }),
);

export default router;
