# 🧠 BudgetBrain

Local-first personal expense tracker with AI auto-categorization. Everything runs on your machine — the only external call is to the free-tier Google Gemini API, and only ever from the backend.

**Modules**

1. **Transaction Ledger** — manual entry + CSV import (with a mandatory column-mapping/preview step), dashboard with summary cards, category pie, 6-month spending bar, and a paginated, filterable transaction list with inline category editing.
2. **AI Auto-Categorization** — Gemini assigns categories to `Uncategorized` transactions in batches of ≤40 with a 5s delay between batches (free-tier friendly), backed by a merchant cache so a merchant is only ever paid for once. Local anomaly flagging (3× category median / 30%-of-income rules) and cached budget suggestions.
3. **Smart Goal Tracking** — savings goals with required-weekly-savings math, spending velocity (trailing 8 weeks), on-track status, and projected completion.
4. **Accounts** — email/password signup and login (session cookies, not JWT), forgot/reset password by email, and every other module scoped to the logged-in user.

**Stack:** React 18 + Vite + TypeScript + Tailwind + Recharts · Express + TypeScript · SQLite (`better-sqlite3`) · `zod` · `papaparse` · Gemini `gemini-2.0-flash`.

## Setup

```bash
npm install

# Optional but recommended — enables AI categorization + suggestions:
cp server/.env.example server/.env
#   then edit server/.env and set GEMINI_API_KEY (free key: https://aistudio.google.com/apikey)

# Optional: seed ~100 realistic fake transactions for a lively dashboard
npm run seed

npm run dev
```

Open **http://localhost:5173**. The Express API runs on `http://localhost:3001`; the Vite dev server proxies `/api` to it. On first visit you'll see the login screen — sign up with any email and an 8+ character password to create your account (or log in with `demo@budgetbrain.local` / `password123` if you ran `npm run seed`).

Without a Gemini key everything still works — imports land as `Uncategorized` and the UI shows a clear banner/error instead of AI results.

## Screenshots

_Run `npm run seed && npm run dev` and open http://localhost:5173 — screenshots to be added._

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Starts server (:3001) and client (:5173) together |
| `npm run seed` | Wipes and reseeds the DB with ~100 fake transactions, sets monthly income to $5,200 |
| `npm run build` | Typechecks and builds both workspaces |

## Where things live

- SQLite file: `server/data/budgetbrain.db` (gitignored; delete it to start fresh — migrations recreate it)
- Gemini call log: `server/logs/gemini.log` (timestamp, batch size, outcome — never the key)
- API key: `server/.env` only (gitignored). The frontend never sees it and never calls Gemini directly.

## Security notes

- All money values are **integer cents** end-to-end (`*_cents` fields); conversion to dollars happens only at render/input time, with string/integer math — no floats.
- All SQL goes through `better-sqlite3` prepared statements; all request bodies are validated with `zod` (400 + field-level messages).
- `express-rate-limit` caps the API at 300 req/min.
- Categorization sends only description strings to Gemini; budget suggestions send only per-category monthly totals — never the raw transaction history.
- No `dangerouslySetInnerHTML` anywhere; React escaping handles CSV cell rendering.
- Passwords are hashed with `bcryptjs` (never stored or logged in plaintext); sessions are opaque random tokens looked up server-side (a `sessions` table), not JWTs — logging out actually invalidates them rather than just discarding a client-side token.
- Only a SHA-256 hash of a session or password-reset token is ever stored — a copy of the database alone can't be replayed as a valid cookie or reset link.
- Login/signup responses never reveal whether an email has an account (same generic error for "wrong password" and "no such account"; forgot-password always returns the same message).
- `/api/auth/*` has its own tighter rate limit (20 requests/15 min) than the general API limit, since login/signup are the most common brute-force targets.

## Design decisions / assumptions

Places where the requirements left room for interpretation:

- **Transfers** are excluded from spent/income/net totals, charts, velocity, and anomaly checks, so moving money between your own accounts doesn't read as spending.
- **Duplicate CSV rows** (same date, amount, normalized merchant) are imported anyway and reported as warnings in the import summary ("warn, don't block"), with a pointer to review/delete them on the dashboard.
- **Ambiguous CSV dates** (e.g. `03/04/2025`) hard-require a MM/DD vs DD/MM radio choice before the import will run; unambiguous rows (`14/02/2025`, ISO, `Mar 4, 2025`) parse automatically.
- **Categorize after import** is a one-click button on the import summary rather than fully automatic, so an import never spends API quota without an explicit go-ahead.
- **Dismissed anomaly flags stay dismissed** across recomputes (a `flag_dismissed` column), otherwise every re-run would resurrect them.
- **Goal progress** is measured as cumulative net savings (income − expenses, Transfers excluded) since the goal's creation date, clamped to [0, target] — the v1 schema has no per-goal contributions.
- **Pie chart colors**: the 8 highest-traffic categories own fixed palette slots (colorblind-validated ordering); everything else folds into a single muted "Everything else" slice so hues are never cycled or reassigned.
- The **seed script** intentionally leaves the last ~12 days of expenses `Uncategorized` so the ✨ Categorize button has a live demo, and plants two anomalies (an $850 dinner, a $1,799 Apple purchase) for the flagging demo.
- **Legacy data**: the app was originally single-user, so pre-login rows (transactions/goals/settings with no owner) exist in older databases. The *very first* account ever created automatically inherits all of that ownerless data (`claimLegacyDataIfFirstUser` in `server/src/services/auth.ts`); every account signed up after that starts genuinely empty. A fresh database with no legacy rows behaves the same either way.

## API

```
GET    /api/health
POST   /api/auth/signup
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
POST   /api/auth/forgot-password
POST   /api/auth/reset-password
GET    /api/transactions?month=&category=&search=&page=&flagged=
POST   /api/transactions
POST   /api/transactions/import        (≤1,000 rows; row-level skip reporting)
PATCH  /api/transactions/:id
DELETE /api/transactions/:id
GET    /api/summary?month=YYYY-MM      (totals + by-category + 6-month series, all SQL aggregates)
GET/PUT /api/settings
POST   /api/categorize                 (starts a run; 409 if one is running)
GET    /api/categorize/status          (batches done/total, cache hits, errors)
POST   /api/suggestions                (aggregates-only; cached per month+data-hash)
POST   /api/flags/recompute
PATCH  /api/flags/:id/dismiss
POST/GET/PATCH/DELETE /api/goals[/:id]
```

Everything except `/api/health` and `/api/auth/*` requires a logged-in session (an httpOnly `sid` cookie) — a request without one gets a 401.

## Testing

Vitest coverage exists for money math, CSV amount/date parsing, merchant normalization, Gemini response parsing (including a mocked-network test of the 429/5xx retry paths), and the anomaly-flagging boundary rules — 39 tests total. The parsing/normalization logic lives in small pure modules (`client/src/lib/csv.ts`, `client/src/lib/money.ts`, `server/src/lib/normalize.ts`, `server/src/services/gemini.ts`) precisely so it can be unit-tested without touching the network or the DB; the anomaly rules were pulled out of `recomputeFlags()` into a pure `evaluateAnomaly()` in `server/src/services/anomaly.ts` for the same reason.

**Auth tests** live alongside the rest of the server suite:
- `server/src/__tests__/auth.unit.test.ts` — password hashing/verification, session/reset token generation, and email validation, as pure functions.
- `server/src/__tests__/auth.integration.test.ts` — spins up the real Express app (`server/src/app.ts`) with `supertest` against a throwaway in-memory database (`DATABASE_PATH=:memory:`, set in `server/vitest.setup.ts`), and drives full signup/login/logout/session flows, per-user data isolation, the legacy-data claim, and forgot/reset-password end to end — no mocking of the app's own routes or DB layer.
- `e2e/tests/auth.spec.ts` (Playwright) covers the same flows through the real browser UI; every other e2e spec now logs in first via the shared `login()` helper in `e2e/tests/utils.ts`, since every screen requires a session.

Run `npm test -w client` and `npm test -w server` — the root `npm test` currently only runs the server workspace (see known gaps below).

**Known gaps, not yet covered:**
- CSV import's debit/credit two-column mode and duplicate-row detection (`convertRows` in `client/src/lib/csv.ts`).
- The AI response's "unknown category → mapped to Other" fallback, which lives in `parseBatchResponse` inside `server/src/services/categorizer.ts` and isn't currently exported for direct unit testing.
- `formatCentsCompact` (`client/src/lib/money.ts`) and `autoDetectMapping` (`client/src/lib/csv.ts`).
