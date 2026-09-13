# 🧠 BudgetBrain

Personal expense tracker with AI auto-categorization. Runs locally against a SQLite file, or deployed against a hosted [Turso](https://turso.tech) database — same driver, same code path, no branching. The only outbound calls are to the free-tier Google Gemini API, and only ever from the backend — never the raw file, always redacted first for PDF import (see Security notes).

[![CI](https://github.com/nikhilpatil30sept-hash/budgetbrain/actions/workflows/ci.yml/badge.svg)](https://github.com/nikhilpatil30sept-hash/budgetbrain/actions/workflows/ci.yml)

**Modules**

1. **Transaction Ledger** — manual entry + CSV import (with a mandatory column-mapping/preview step) + PDF statement import (digital statements only; AI-extracted via Gemini after the text is cropped and redacted in the browser), dashboard with summary cards, category pie, 6-month spending bar, and a paginated, filterable transaction list with inline category editing.
2. **AI Auto-Categorization** — Gemini assigns categories to `Uncategorized` transactions in batches of ≤40 with a 5s delay between batches (free-tier friendly), backed by a merchant cache so a merchant is only ever paid for once. Local anomaly flagging (3× category median / 30%-of-income rules) and cached budget suggestions.
3. **Smart Goal Tracking** — savings goals with required-weekly-savings math, spending velocity (trailing 8 weeks), on-track status, and projected completion.
4. **Accounts** — email/password signup and login (session cookies, not JWT), forgot/reset password by email, and every other module scoped to the logged-in user.

**Stack:** React 18 + Vite + TypeScript + Tailwind + Recharts · Express + TypeScript · SQLite (`@libsql/client` — a local file locally, [Turso](https://turso.tech) in production, same driver and code path either way) · `zod` · `papaparse` · `pdfjs-dist` (client-side PDF text extraction) · Gemini `gemini-3.5-flash-lite`.

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

Leave `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` unset for local development — the app falls back to a local SQLite file (`server/data/budgetbrain.db`) automatically. Those two vars only matter once you deploy (see **Deploy** below).

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
| `npm test` | Runs the full Vitest suite — both workspaces, 169 tests |
| `npm run test:coverage` | Same, with a coverage report (text + HTML in `<workspace>/coverage/`) |
| `npm run lint` | ESLint across server, client and e2e |
| `npm run loadtest -w server` | Load smoke test against a running instance (see `TEST-PLAN.md` §8) |
| `npx playwright test` | End-to-end suite — **run from inside `e2e/`**, which is a standalone project, not a workspace |

## Where things live

- SQLite file: `server/data/budgetbrain.db` (gitignored; delete it to start fresh — migrations recreate it). Only used locally — in production the same code talks to a Turso database instead (`TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`), no code change required.
- Gemini call log: `server/logs/gemini.log` (timestamp, batch size, outcome — never the key)
- API key: `server/.env` only (gitignored). The frontend never sees it and never calls Gemini directly.

## Security notes

- All money values are **integer cents** end-to-end (`*_cents` fields); conversion to dollars happens only at render/input time, with string/integer math — no floats.
- All SQL goes through parameterized queries via `@libsql/client` (never string-concatenated); all request bodies are validated with `zod` (400 + field-level messages).
- `express-rate-limit` caps the API at 300 req/min.
- Categorization sends only description strings to Gemini; budget suggestions send only per-category monthly totals; PDF import sends the statement's transaction-table text — cropped to exclude the name/address/account-number block above it, and with any remaining long ID-shaped numbers, emails, or phone numbers redacted, all client-side before the request is made — never the raw PDF, never the un-redacted text, never the raw transaction history.
- No `dangerouslySetInnerHTML` anywhere; React escaping handles CSV cell rendering.
- Passwords are hashed with `bcryptjs` (never stored or logged in plaintext); sessions are opaque random tokens looked up server-side (a `sessions` table), not JWTs — logging out actually invalidates them rather than just discarding a client-side token.
- Only a SHA-256 hash of a session or password-reset token is ever stored — a copy of the database alone can't be replayed as a valid cookie or reset link.
- Login/signup responses never reveal whether an email has an account (same generic error for "wrong password" and "no such account"; forgot-password always returns the same message).
- `/api/auth/*` has its own tighter rate limit (20 requests/15 min) than the general API limit, since login/signup are the most common brute-force targets.

## Deploy

BudgetBrain deploys as one free web service on [Render](https://render.com), with [Turso](https://turso.tech) as the persistent database (Render's free tier has no persistent disk). Express serves the built React client from the same origin as the API — no separate static host, no cross-origin cookies.

1. Create a Turso database and grab its URL + token: `turso db create budgetbrain-prod`, `turso db show budgetbrain-prod --url`, `turso db tokens create budgetbrain-prod`. If you already have real local data in `server/data/budgetbrain.db` you want to keep, checkpoint and import it instead of creating an empty database: `sqlite3 server/data/budgetbrain.db "PRAGMA wal_checkpoint(TRUNCATE);"` then `turso db create budgetbrain-prod --from-file server/data/budgetbrain.db`.
2. Push this repo to GitHub, then either apply the included `render.yaml` as a Render Blueprint, or create a Render web service manually with build command `npm ci && npm run build`, start command `node server/dist/index.js`, and health check path `/api/health`.
3. In the Render dashboard, set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `NODE_ENV=production`, `GEMINI_API_KEY`, `RESEND_API_KEY`, `MAIL_FROM`, and `APP_URL` (the `https://<your-service>.onrender.com` URL Render assigns — needed so password-reset emails link to the right place). Don't set `PORT` — Render injects it.
4. Deploy. The free tier sleeps after 15 minutes idle, so the first request after a quiet period takes about a minute to wake back up — expected, not a bug.

## Design decisions / assumptions

Places where the requirements left room for interpretation:

- **Transfers** are excluded from spent/income/net totals, charts, velocity, and anomaly checks, so moving money between your own accounts doesn't read as spending.
- **Duplicate CSV rows** (same date, amount, normalized merchant) are imported anyway and reported as warnings in the import summary ("warn, don't block"), with a pointer to review/delete them on the dashboard.
- **Ambiguous CSV dates** (e.g. `03/04/2025`) hard-require a MM/DD vs DD/MM radio choice before the import will run; unambiguous rows (`14/02/2025`, ISO, `Mar 4, 2025`) parse automatically.
- **PDF import is digital-only, any bank.** Scanned/photographed statements are rejected outright (no OCR) — we check for a real text layer before ever calling the AI. Rather than trying to mask every possible PII field for every bank's layout, the app finds where the transaction table starts and only sends that part onward; the identity block above it is never transmitted. A defense-in-depth regex pass also redacts long ID-shaped numbers (including bank-style asterisk-masked references like `*****12*3456`), emails, phone numbers, and whole lines that look like a repeated per-page identity header (salutation-prefixed, or containing an `XXXX`-masked card number) in what remains — a real statement was found during testing to repeat its "MR NAME – masked card" header after the first page, which the original crop-only approach missed. The masked text is shown to you before anything is sent, and extracted rows flow through the exact same date/amount parsing CSV import uses.
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

Roughly 169 automated tests plus 17 end-to-end journeys, all gated by CI on every push. `TEST-PLAN.md` covers the strategy and `TEST-CASES.md` the individual manual cases; this section is the map of what runs where.

| Layer | Where | Size | What it covers |
|---|---|---|---|
| **Unit** | `server/src/__tests__/`, `client/src/**/__tests__/` | 56 | Pure functions, no DB or network. Merchant normalization, anomaly boundary rules, password/token hashing, Gemini response parsing (network mocked), money formatting, CSV amount/date parsing. |
| **Integration** | `server/src/__tests__/*.integration.test.ts` | 93 | Real requests through the whole Express app via `supertest` into a real DB — no port bound, no browser. Auth, transactions, goals, settings, summary maths, AI orchestration, cross-user isolation. |
| **Component** | `client/src/**/__tests__/*.test.tsx` | 20 | React Testing Library + jsdom. Queries by visible label and accessible role, never by CSS class — so a missing label breaks the test. |
| **End-to-end** | `e2e/tests/*.spec.ts` | 17 × 4 browsers | Playwright against Chromium, Firefox, WebKit and a Pixel 5 viewport. Auth flows, transaction entry, validation rejections, layout, persistence, accessibility. |

```bash
npm test                 # all 169, both workspaces, ~12s
npm run test:coverage    # same, plus a coverage report
cd e2e && npx playwright test   # the browser suite, ~90s
```

**Coverage** (Vitest v8): server 86% statements / 75% branches; client 72% / 64%. Branch coverage is the figure worth watching — it asks whether *both* outcomes of each condition ran.

**Design choices worth knowing:**

- The parsing and rule logic lives in small pure modules (`client/src/lib/csv.ts`, `client/src/lib/money.ts`, `server/src/lib/normalize.ts`, `server/src/services/gemini.ts`) precisely so it can be unit-tested without the network or the DB. The anomaly rules were pulled out of `recomputeFlags()` into a pure `evaluateAnomaly()` in `server/src/services/anomaly.ts` for the same reason.
- Integration tests run against an in-memory database (`DATABASE_PATH=:memory:`, set in `server/vitest.setup.ts`) and `resetDb()` wipes every table before each test, so no test can be affected by one that ran before it.
- The e2e suite runs serially (`workers: 1`) because every spec shares one dev server and one database, and some assert on global figures — BB-1 checks the monthly total moves by exactly the amount added. Parallelising without per-test data isolation would trade a slow suite for a flaky one.
- Rate limits are environment-gated (300/min in production, 2,000 elsewhere; `/api/auth/*` 20 per 15 min in production, 1,000 elsewhere). A full four-browser Playwright run generates enough traffic from one address to exhaust the production limits, which produced `429`s that looked exactly like flaky timing until diagnosed.

**CI** (`.github/workflows/ci.yml`) runs on every push and PR, ordered cheapest-first so a compile error costs seconds rather than minutes: install → lint → `npm audit --omit=dev` → build → unit/integration with coverage → seed → Playwright across all four browsers. Coverage and Playwright reports upload as artifacts even on failure. `main` deploys to Render, so this pipeline is the last gate before production.

**Known gaps, not yet covered:**

- **`convertRows` in `client/src/lib/csv.ts`** — the debit/credit two-column mode and client-side duplicate detection have no direct unit test. (Server-side duplicate flagging *is* covered, in `transactions.integration.test.ts`.)
- **The AI's "unknown category → Other" fallback** in `parseBatchResponse` (`server/src/services/categorizer.ts`) isn't exported, so it can't be unit-tested directly.
- **`formatCentsCompact`** and **`autoDetectMapping`** have no direct tests — `autoDetectMapping` is exercised indirectly through `ImportPage.test.tsx`.
- **The server's empty-description rejection** is covered end-to-end but has no integration test, unlike the other validation rules.
- **The 500-character description cap** (`schemas.ts`) is verified manually only.
- **No mutation testing**, so nothing proves the assertions are strong rather than merely present. **No visual regression testing.** Load testing exists but is manual, not in CI.
