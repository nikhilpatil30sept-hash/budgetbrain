import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { authRouter } from "./routes/auth.js";
import { requireAuth } from "./middleware/auth.js";
import { transactionsRouter } from "./routes/transactions.js";
import { summaryRouter } from "./routes/summary.js";
import { settingsRouter } from "./routes/settings.js";
import { goalsRouter } from "./routes/goals.js";
import { aiRouter } from "./routes/ai.js";
import { hasApiKey } from "./services/gemini.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/dist/app.js -> repo root -> client/dist
const CLIENT_DIST = path.join(__dirname, "..", "..", "client", "dist");

/**
 * Builds the Express app without starting a server. Pulled out of index.ts
 * so tests (supertest) and the real entrypoint can share one definition
 * instead of the test suite needing to spin up a real port.
 */
export function createApp() {
  const app = express();

  // Render (and most PaaS hosts) sit behind a reverse proxy that sets
  // X-Forwarded-For. Without this, express-rate-limit throws
  // ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on every request and can key its
  // limits off the wrong IP. `1` = trust exactly one hop (Render's own
  // proxy), which is correct for this deployment and doesn't open us up to
  // client-spoofed X-Forwarded-For headers.
  if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }

  // Local dev only: the Vite dev server (:5173) and Express (:3001) are
  // different origins there. In production the client is served from this
  // same Express app (see the static block below), so no CORS is needed —
  // leaving it on would just be a config foot-gun (a hardcoded dev origin).
  if (process.env.NODE_ENV !== "production") {
    app.use(cors({ origin: "http://localhost:5173", credentials: true }));
  }
  app.use(cookieParser());
  app.use(express.json({ limit: "2mb" })); // 1,000-row imports fit comfortably

  // Cheap local rate limit (requirements 7.7). Generous enough for the UI's
  // 1s categorization-status polling.
  //
  // Environment-gated the same way authLimiter (routes/auth.ts) already is:
  // a real burst of Playwright traffic -- every project x every test x every
  // retry, all from one IP against one long-lived dev-server process -- can
  // add up to more than 300 requests in a 60s window well before anything is
  // actually wrong. That doesn't test this middleware, it just makes CI
  // flaky in a way that looks like a timing bug (a 429 is rejected outright,
  // not slow, so no client-side timeout can ever paper over it). The
  // production number is unchanged.
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: process.env.NODE_ENV === "production" ? 300 : 2000,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, gemini_key_configured: hasApiKey(), time: new Date().toISOString() });
  });

  // Signup/login/logout/forgot-password/reset-password — no login required
  // to reach these (that's the point). Everything else below needs a session.
  app.use("/api/auth", authRouter);

  app.use("/api/transactions", requireAuth, transactionsRouter);
  app.use("/api/summary", requireAuth, summaryRouter);
  app.use("/api/settings", requireAuth, settingsRouter);
  app.use("/api/goals", requireAuth, goalsRouter);
  app.use("/api", requireAuth, aiRouter);

  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

  // Serves the built React app from this same origin in production, so
  // there's no separate static host and no cross-origin cookies to worry
  // about. The client has no client-side router today, so this wildcard
  // fallback isn't load-bearing, but it's cheap and correct to have anyway.
  app.use(express.static(CLIENT_DIST));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });

  // Last-resort error handler: always JSON, never a stack trace to the client.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
