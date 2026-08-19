import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { transactionsRouter } from "./routes/transactions.js";
import { summaryRouter } from "./routes/summary.js";
import { settingsRouter } from "./routes/settings.js";
import { goalsRouter } from "./routes/goals.js";
import { aiRouter } from "./routes/ai.js";
import { hasApiKey } from "./services/gemini.js";

const app = express();
const PORT = Number(process.env.PORT || 3001);

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json({ limit: "2mb" })); // 1,000-row imports fit comfortably

// Cheap local rate limit (requirements 7.7). Generous enough for the UI's
// 1s categorization-status polling.
app.use(
  "/api",
  rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false })
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, gemini_key_configured: hasApiKey(), time: new Date().toISOString() });
});

app.use("/api/transactions", transactionsRouter);
app.use("/api/summary", summaryRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/goals", goalsRouter);
app.use("/api", aiRouter);

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

// Last-resort error handler: always JSON, never a stack trace to the client.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`BudgetBrain server listening on http://localhost:${PORT}`);
  if (!hasApiKey()) {
    console.warn(
      "⚠ GEMINI_API_KEY not set — the app works, but AI categorization and suggestions will be unavailable. Copy server/.env.example to server/.env and add your key."
    );
  }
});
