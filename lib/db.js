// Database layer — Turso (libSQL) for Vercel deployment.
// Falls back to LOCAL file-based libSQL when TURSO_DATABASE_URL is not set
// (handy for `npm run dev` without Turso account).
import { createClient } from "@libsql/client";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let client;

if (process.env.TURSO_DATABASE_URL) {
  client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
} else {
  // Local dev: file-based libSQL (no Turso account needed).
  // Auto-creates database/data.db.
  const localPath = path.join(__dirname, "..", "database", "data.db");
  client = createClient({ url: `file:${localPath}` });
}

// ===== Schema bootstrap (run once on startup; idempotent) =====
let schemaReady = null;
const ensureSchema = () => {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await client.batch(
      [
        `CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'user',
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS apikeys (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          apikey TEXT UNIQUE NOT NULL,
          plan TEXT NOT NULL DEFAULT 'free',
          used_today INTEGER NOT NULL DEFAULT 0,
          last_reset TEXT NOT NULL DEFAULT '',
          expiry INTEGER,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`,
        `CREATE INDEX IF NOT EXISTS idx_apikey ON apikeys(apikey)`,
        `CREATE INDEX IF NOT EXISTS idx_apikey_user ON apikeys(user_id)`,
        `CREATE TABLE IF NOT EXISTS logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          apikey TEXT,
          endpoint TEXT NOT NULL,
          status INTEGER NOT NULL,
          ip TEXT,
          timestamp INTEGER NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_logs_apikey ON logs(apikey)`,
        `CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(timestamp)`,
      ],
      "write",
    );
  })();
  return schemaReady;
};

const run = async (sql, args = []) => {
  await ensureSchema();
  return client.execute({ sql, args });
};

const get = async (sql, args = []) => {
  const r = await run(sql, args);
  return r.rows[0] || null;
};

const all = async (sql, args = []) => {
  const r = await run(sql, args);
  return r.rows;
};

// ===== Helpers =====
const todayWIB = () => {
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
};

// ===== Users =====
export const users = {
  async create({ username, email, password_hash, role = "user" }) {
    const r = await run(
      `INSERT INTO users (username, email, password_hash, role, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [username, email, password_hash, role, Date.now()],
    );
    return Number(r.lastInsertRowid);
  },
  byUsername: (u) => get(`SELECT * FROM users WHERE username = ?`, [u]),
  byEmail: (e) => get(`SELECT * FROM users WHERE email = ?`, [e]),
  byId: (id) => get(`SELECT * FROM users WHERE id = ?`, [id]),
  count: async () => {
    const r = await get(`SELECT COUNT(*) AS n FROM users`);
    return Number(r?.n || 0);
  },
  setRole: (id, role) => run(`UPDATE users SET role = ? WHERE id = ?`, [role, id]),
  list: () =>
    all(
      `SELECT u.id, u.username, u.email, u.role, u.created_at,
              k.apikey, k.plan, k.used_today, k.expiry
         FROM users u
         LEFT JOIN apikeys k ON k.user_id = u.id
         ORDER BY u.id DESC LIMIT 200`,
    ),
};

// ===== API keys =====
export const apikeys = {
  create: ({ user_id, apikey, plan = "free", expiry = null }) =>
    run(
      `INSERT INTO apikeys (user_id, apikey, plan, last_reset, expiry, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user_id, apikey, plan, todayWIB(), expiry, Date.now()],
    ),
  get: (key) => get(`SELECT * FROM apikeys WHERE apikey = ?`, [key]),
  getByUserId: (id) => get(`SELECT * FROM apikeys WHERE user_id = ?`, [id]),
  async resetIfNewDay(row) {
    const today = todayWIB();
    if (row.last_reset !== today) {
      await run(
        `UPDATE apikeys SET used_today = 0, last_reset = ? WHERE id = ?`,
        [today, row.id],
      );
      row.used_today = 0;
      row.last_reset = today;
    }
    return row;
  },
  incrementUsage: (id) =>
    run(`UPDATE apikeys SET used_today = used_today + 1 WHERE id = ?`, [id]),
  updatePlan: (user_id, plan, expiry = null) =>
    run(`UPDATE apikeys SET plan = ?, expiry = ? WHERE user_id = ?`, [
      plan,
      expiry,
      user_id,
    ]),
  rotate: (user_id, newKey) =>
    run(`UPDATE apikeys SET apikey = ? WHERE user_id = ?`, [newKey, user_id]),
};

// ===== Logs =====
export const logs = {
  insert: ({ apikey, endpoint, status, ip }) =>
    run(
      `INSERT INTO logs (apikey, endpoint, status, ip, timestamp)
       VALUES (?, ?, ?, ?, ?)`,
      [apikey || null, endpoint, status, ip || null, Date.now()],
    ),
  recentByApikey: (k) =>
    all(
      `SELECT endpoint, status, timestamp FROM logs
        WHERE apikey = ? ORDER BY timestamp DESC LIMIT 50`,
      [k],
    ),
  todayCountByApikey: async (k) => {
    const startOfDay = (() => {
      const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
      now.setUTCHours(0, 0, 0, 0);
      return now.getTime() - 7 * 60 * 60 * 1000;
    })();
    const r = await get(
      `SELECT COUNT(*) AS n FROM logs WHERE apikey = ? AND timestamp >= ?`,
      [k, startOfDay],
    );
    return Number(r?.n || 0);
  },
};

export default client;
