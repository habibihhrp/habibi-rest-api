// Vercel serverless entry — wraps the Express app.
// All requests go through this single function thanks to vercel.json rewrites.
import app from "../server.js";
export default app;
