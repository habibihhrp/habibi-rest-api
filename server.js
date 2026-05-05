// REST API server entry — Express app.
// Local dev: `npm start` listens on PORT (default 3000).
// Vercel: api/index.js wraps this app for serverless deployment.
import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import downloaderRoutes from "./routes/downloader.js";
import toolsRoutes from "./routes/tools.js";
import searchRoutes from "./routes/search.js";
import aiRoutes from "./routes/ai.js";
import randomRoutes from "./routes/random.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.set("trust proxy", true);
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Health check (no auth)
app.get("/api/health", (req, res) =>
  res.json({ status: true, message: "ok", time: Date.now() }),
);

// Auth (no auth required for register/login)
app.use("/api/auth", authRoutes);

// Admin (jwt-auth + admin-only inside)
app.use("/api/admin", adminRoutes);

// Public API (apikey-auth inside each route)
app.use("/api/downloader", downloaderRoutes);
app.use("/api/tools", toolsRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/random", randomRoutes);

// Static dashboard
app.use(express.static(path.join(__dirname, "public")));

// SPA fallback — serve index.html for any unmatched path that isn't /api/*
app.get(/^(?!\/api\/).*$/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 404 for /api/* not matched
app.use((req, res) => {
  res
    .status(404)
    .json({ status: false, code: 404, message: `Not found: ${req.originalUrl}` });
});

// Error handler
app.use((err, req, res, _next) => {
  console.error("[server error]", err);
  res
    .status(500)
    .json({ status: false, code: 500, message: err.message || "Server error" });
});

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

// Only listen when run directly (not when imported by Vercel serverless wrapper)
if (process.env.VERCEL !== "1") {
  app.listen(PORT, HOST, () => {
    console.log(`✅ Habibi REST API ready on http://${HOST}:${PORT}`);
    console.log(`   Health: http://${HOST}:${PORT}/api/health`);
    console.log(`   Dashboard: http://${HOST}:${PORT}/`);
  });
}

export default app;
