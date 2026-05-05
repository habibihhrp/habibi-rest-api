# ⚡ Habibi REST API

Personal REST API service inspired by autoresbot/lolhuman — siap deploy ke Vercel + Turso (gratis).

## Fitur

- 🔐 **Apikey authentication** — query (`?apikey=`) atau header (`X-API-Key`)
- 📊 **Daily limit per plan** — free 100/hari, premium unlimited (auto-reset 00:00 WIB)
- 👥 **User registration + login** dengan JWT (7 hari)
- 🛡️ **Admin panel** untuk upgrade plan, set role
- 📝 **Request logging** — usage history per apikey
- 🌐 **Dashboard frontend** (Tailwind + vanilla JS, no build step)

## Endpoints (50+ — 7 kategori)

| Kategori | Jumlah | Endpoints |
|---|---|---|
| 📥 Downloader | 10 | tiktok, instagram, youtube, ytmp4, ytmp3, facebook, twitter, threads, mediafire, spotify |
| 🤖 AI | 5 | chat (Groq Llama), gemini, imagine (Pollinations), tts (Google TTS), translate |
| 🛠️ Tools | 12 | brat, ssweb, qrcode, nulis, shorturl, base64, hash, iplookup, weather, color, uuid, password |
| 🔍 Search | 8 | github, wikipedia, npm, lirik, kbbi (Wiktionary), google, pinterest, tiktok |
| 🎲 Random | 11 | quote, fact, joke, gombal, katabijak, dilan, fakta-id, waifu, dog, cat, meme |
| 👀 Stalk | 3 | github, instagram, tiktok user profiles |
| 🕌 Islam | 4 | jadwal-sholat, asmaul-husna, surah, hadits |

Full live-tester docs di `/docs.html` setelah deploy.

## Quick Start (Local Dev)

### 1. Install
```bash
npm install
```

### 2. Setup `.env`
```bash
cp .env.example .env
# Edit JWT_SECRET (random string min 32 chars)
# Optional: GROQ_API_KEY untuk AI endpoint
```

Tanpa `TURSO_DATABASE_URL`, otomatis pakai SQLite lokal di `database/data.db`.

### 3. Run
```bash
npm start
```

Buka `http://localhost:3000` — daftar user pertama otomatis dapet role `admin`.

## Deploy ke Vercel + Turso (Gratis)

### Step 1 — Setup Turso (database)

1. Daftar di [turso.tech](https://turso.tech) (gratis 9GB).
2. Install CLI:
   ```bash
   curl -sSfL https://get.tur.so/install.sh | bash
   turso auth signup     # atau `turso auth login`
   ```
3. Bikin database:
   ```bash
   turso db create habibi-api
   ```
4. Dapetin URL + token:
   ```bash
   turso db show habibi-api --url
   turso db tokens create habibi-api
   ```
   ⚠️ Token yang valid format-nya panjang dengan payload `{"a":"rw",...}` (read-write database token), **bukan** "Platform API token" dari menu account.

### Step 2 — Deploy ke Vercel

1. Push project ke GitHub (atau pakai `vercel --prod` langsung).
2. Login [vercel.com](https://vercel.com) → "New Project" → import repo.
3. **Environment Variables** (tambah sebelum deploy):
   ```
   TURSO_DATABASE_URL = libsql://habibi-api-xxx.turso.io
   TURSO_AUTH_TOKEN   = <token dari step 1.4>
   JWT_SECRET         = <random 32+ chars>
   GROQ_API_KEY       = <optional, daftar gratis di console.groq.com>
   ADMIN_USERNAME     = <optional, username yg auto-jadi admin>
   ```
4. Klik **Deploy**. Selesai dalam ~30 detik.
5. Custom domain dari Cloudflare:
   - Vercel dashboard → Settings → Domains → Add `api.kamu.com`
   - Vercel kasih CNAME target (mis. `cname.vercel-dns.com`)
   - Cloudflare dashboard → DNS → Add CNAME `api → cname.vercel-dns.com` (proxy: DNS only / abu-abu)
   - Tunggu propagasi (5 menit), HTTPS auto-active.

### Step 3 — Test

Setelah deploy, buka `https://api.kamu.com/`. Daftar akun pertama (auto-admin), copy apikey, test:

```bash
curl "https://api.kamu.com/api/random/quote?apikey=YOUR_APIKEY"
```

## Folder Structure

```
habibi-rest-api/
├── server.js              # Express app (entry untuk local dev)
├── api/index.js           # Vercel serverless wrapper
├── vercel.json            # Vercel deployment config
├── package.json
├── .env.example
├── lib/
│   ├── db.js              # Turso/libSQL client + schema + queries
│   ├── auth.js            # JWT + apikey middleware
│   └── respond.js         # Response helpers
├── routes/
│   ├── auth.js            # register, login, me, rotate-apikey
│   ├── admin.js           # list users, upgrade plan, set role
│   ├── downloader.js      # 10 endpoints (tiktok, ig, yt, fb, twitter, ...)
│   ├── tools.js           # 12 utility endpoints (brat, qrcode, hash, weather, ...)
│   ├── search.js          # 8 search endpoints (github, npm, lirik, kbbi, ...)
│   ├── ai.js              # 5 AI endpoints (chat, gemini, imagine, tts, translate)
│   ├── random.js          # 11 random endpoints (quote, joke, gombal, ...)
│   ├── stalk.js           # 3 profile-stalk endpoints (gh, ig, tt)
│   └── islam.js           # 4 islamic endpoints (jadwal sholat, surah, ...)
└── public/
    ├── index.html         # Landing page
    ├── login.html
    ├── register.html
    ├── dashboard.html     # Show apikey, usage, recent logs
    ├── admin.html         # User management
    ├── docs.html          # Auto-generated API docs
    ├── css/style.css
    └── js/app.js          # Shared client helpers
```

## Database Schema

```sql
users (id, username, email, password_hash, role, created_at)
apikeys (id, user_id, apikey, plan, used_today, last_reset, expiry, created_at)
logs (id, apikey, endpoint, status, ip, timestamp)
```

Auto-created on first run via `lib/db.js:ensureSchema()`.

## Plan Tiers

| Plan | Limit/day |
|---|---|
| `free` | 100 (configurable via `LIMIT_FREE`) |
| `premium` | 999999 (configurable via `LIMIT_PREMIUM`) |

Admin upgrade user via `POST /api/admin/upgrade` (lihat dashboard `/admin.html`).

## Rate Limit Behavior

- Pertama kali apikey dipakai di hari baru → `last_reset` ke-update, `used_today` reset ke 0
- Tiap request sukses → `used_today += 1`
- Saat `used_today >= limit` → response 429 dengan `{plan, used_today, limit}`
- Reset terjadi otomatis saat request berikutnya melewati 00:00 WIB

## API Contract

### Success
```json
{
  "status": true,
  "code": 200,
  "result": { /* data */ }
}
```

### Error
```json
{
  "status": false,
  "code": 401,
  "message": "Invalid API key."
}
```

### Binary endpoints (image)
- `Content-Type: image/png` atau `image/jpeg`
- Body = raw bytes (bukan JSON)

## Tambahin Endpoint Baru

1. Bikin file di `routes/myfeature.js`:
   ```js
   import express from "express";
   import { apikeyAuth, logSuccess } from "../lib/auth.js";
   import { ok, fail, tryCatch } from "../lib/respond.js";
   const router = express.Router();
   router.get("/hello", apikeyAuth, tryCatch(async (req, res) => {
     const name = String(req.query.name || "world").trim();
     logSuccess(req);
     return ok(res, { greeting: `Hello, ${name}!` });
   }));
   export default router;
   ```
2. Wire di `server.js`:
   ```js
   import myFeatureRoutes from "./routes/myfeature.js";
   app.use("/api/myfeature", myFeatureRoutes);
   ```
3. Update `public/docs.html` (tambah ke `ENDPOINTS` array).
4. Deploy ulang.

## Security Notes

- **Rotate JWT_SECRET** kalau ke-leak → semua sesi user dipaksa logout.
- **Rotate Turso token** kalau ke-leak → app gak bisa konek db sampai update env var.
- Apikey disimpan plaintext di db (industry standard untuk apikey ringan). Kalau mau hash, modify `lib/db.js` + `lib/auth.js`.
- Password di-hash bcrypt (10 rounds).

## Troubleshooting

**Error 401 dari Turso saat startup** → token salah. Pastikan token-nya database-scoped (`a:"rw"`), bukan platform API token.

**`SERVER_ERROR` di Vercel logs** → cek env vars set semua. Vercel function timeout default 10s, sudah di-bump ke 30s di `vercel.json`.

**Endpoint downloader 502** → upstream scraper down (TikTok ganti format, IG block, dll). Code-nya best-effort — swap upstream URL kalau perlu.

**Cold start lambat di Vercel** → first hit pasca idle bisa 2-3 detik. Endpoint kedua dst < 200ms. Bisa di-mitigate dengan Vercel Pro (ga ada cold start) atau cron ping tiap 5 menit.

## License

MIT — pakai untuk apa aja, termasuk komersial. Tanpa garansi.
