# 🧠 BudgetBrain

Local-first personal expense tracker with AI auto-categorization. Everything runs on your machine — the only external call is to the free-tier Google Gemini API, and only ever from the backend.

**Modules**

1. **Transaction Ledger** — manual entry + CSV import (with a mandatory column-mapping/preview step), dashboard with summary cards, category pie, 6-month spending bar, and a paginated, filterable transaction list with inline category editing.
2. **AI Auto-Categorization** — Gemini assigns categories to `Uncategorized` transactions in batches of ≤40 with a 5s delay between batches (free-tier friendly), backed by a merchant cache so a merchant is only ever paid for once. Local anomaly flagging (3× category median / 30%-of-income rules) and cached budget suggestions.
3. **Smart Goal Tracking** — savings goals with required-weekly-savings math, spending velocity (trailing 8 weeks), on-track status, and projected completion.

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

Open **http://localhost:5173**. The Express API runs on `http://localhost:3001`; the Vite dev server proxies `/api` to it.

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

## API

```
GET    /api/health
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

## Testing

The Vitest suite from the requirements doc (money math, CSV parsing, merchant normalization, mocked Gemini parsing, anomaly boundaries) is deliberately deferred — the parsing/normalization logic lives in small pure modules (`client/src/lib/csv.ts`, `client/src/lib/money.ts`, `server/src/lib/normalize.ts`, `server/src/services/gemini.ts`) precisely so it can be unit-tested without touching the network or the DB.
