# BudgetBrain — Requirements Document

**Project type:** Local-first B2C expense tracker with AI auto-categorization
**Target environment:** Runs entirely on the developer's local machine. Zero paid services.
**Audience for this document:** Claude Code (AI coding agent). Build in the order specified. Do not skip the security and error-handling requirements.

---

## 1. Project Overview

BudgetBrain is a personal expense tracker with three modules:

1. **Transaction Ledger** — manual entry + CSV import of bank transactions, with a dashboard (charts + transaction list).
2. **AI Auto-Categorization Engine** — Gemini API reads transaction descriptions and assigns categories automatically; flags unusual spending; suggests budget cuts against a stated monthly income.
3. **Smart Goal Tracking** (future expansion, design for it now) — savings goals with required weekly savings computed from spending velocity.

The project must demonstrate: dashboard construction, correct handling of numerical/financial data, aggregate calculations, frontend state management, secure API key handling, and pragmatic AI integration (batching, caching, fallback behavior).

---

## 2. Technology Stack (all free, all local)

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript | Fast local dev, typed money handling |
| Charts | Recharts | Free, simple pie/bar/line charts |
| Styling | Tailwind CSS | Fast, no design system cost |
| Backend | Node.js + Express + TypeScript | Keeps Gemini API key server-side |
| Database | SQLite via `better-sqlite3` | Single file on disk, zero config, free |
| CSV parsing | `papaparse` (frontend preview) + server-side validation | Handles quoted fields, delimiters |
| AI | Google Gemini API — model `gemini-2.0-flash` (or current free-tier flash model) | Free tier: ~15 RPM / ~1,500 requests per day |
| Env/config | `dotenv` | `.env` file, never committed |

**Hard constraints:**
- No paid services, no cloud database, no deployment requirement. `npm run dev` on localhost is the target.
- The Gemini API key lives ONLY in the backend `.env` file. The frontend must never see it. Add `.env` to `.gitignore` in the very first commit, before any other file.
- Monorepo layout: `/client` (Vite app), `/server` (Express app), root `package.json` with a `dev` script that runs both concurrently (use `concurrently`).

---

## 3. Data Model (SQLite)

All money values are stored as **integer cents** (`amount_cents INTEGER`). Never store or compute money as floating point. Convert to dollars only at display time.

### 3.1 `transactions`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| date | TEXT (ISO 8601 `YYYY-MM-DD`) | Required |
| description | TEXT | Raw merchant/description string. Required |
| amount_cents | INTEGER | Negative = expense, positive = income. Required |
| category | TEXT | One of the fixed category list, or `Uncategorized` |
| category_source | TEXT | `manual` \| `ai` \| `cache` — track provenance |
| flagged | INTEGER (0/1) | Set by anomaly detection |
| flag_reason | TEXT NULL | Human-readable reason if flagged |
| created_at | TEXT | ISO timestamp |

### 3.2 `merchant_category_cache`
| Column | Type | Notes |
|---|---|---|
| merchant_key | TEXT PK | Normalized description (lowercased, digits/store-numbers stripped) |
| category | TEXT | |
| hit_count | INTEGER | Increment on reuse |

Purpose: if "WALMART #4521" was categorized once, "WALMART #7788" must resolve from cache without an API call. Normalization rule: lowercase, strip digits, strip punctuation, collapse whitespace, truncate to 40 chars.

### 3.3 `settings`
Key-value table. Initial keys: `monthly_income_cents`, `currency_symbol` (default `$`).

### 3.4 `goals` (Module 3 — create the table now, build UI later)
| Column | Type |
|---|---|
| id | INTEGER PK |
| name | TEXT |
| target_cents | INTEGER |
| deadline | TEXT (ISO date) |
| created_at | TEXT |

### 3.5 Fixed category list
`Groceries, Dining, Entertainment, Transport, Utilities, Rent/Mortgage, Shopping, Health, Subscriptions, Travel, Income, Transfers, Fees, Other, Uncategorized`

The AI must be constrained to this exact list. Never accept a category outside it.

---

## 4. Module 1 — Transaction Ledger (build first)

### 4.1 Manual transaction entry
- Form: date (default today), description, amount, type toggle (expense/income), category dropdown (optional — defaults to `Uncategorized`).
- Validation: date required and not in the future beyond today; description non-empty; amount is a positive decimal with max 2 decimal places, converted to cents on submit; reject `0`.
- On submit: POST to backend, optimistic UI update, rollback with an error toast if the request fails.

### 4.2 CSV import
This is the highest-risk feature. Requirements:

1. User uploads or pastes CSV text.
2. **Preview + column mapping step (mandatory):** parse the first 20 rows client-side with papaparse and show a mapping UI where the user assigns which CSV column is Date, which is Description, which is Amount (or separate Debit/Credit columns). Attempt auto-detection from header names (`date`, `posted`, `description`, `memo`, `payee`, `amount`, `debit`, `credit`) but always let the user override.
3. **Date parsing:** support `YYYY-MM-DD`, `MM/DD/YYYY`, `DD/MM/YYYY`, `DD-MM-YYYY`, and `Mon DD, YYYY`. If format is ambiguous (e.g., `03/04/2025`), ask the user to pick the format via a radio button in the mapping step. Never silently guess.
4. **Amount parsing:** strip currency symbols and thousands separators; handle parentheses as negative (`(45.00)` → `-4500` cents); handle separate debit/credit columns (debit → negative, credit → positive); handle banks that export expenses as positive numbers (user checkbox: "expenses are positive in this file" → invert sign).
5. **Row-level error handling:** invalid rows are skipped, not fatal. After import show a summary: "142 imported, 3 skipped" with the skipped rows and reasons listed.
6. **Duplicate detection:** warn (don't block) if an incoming row matches an existing transaction on (date, amount_cents, normalized description).
7. Cap a single import at 1,000 rows; reject larger files with a clear message.

### 4.3 Dashboard
- **Summary cards:** total spent this month, total income this month, net, count of flagged transactions.
- **Pie chart:** spending by category for a selected month (exclude `Income` and `Transfers`).
- **Bar chart:** last 6 months of total spending.
- **Transaction list:** paginated (50/page) or virtualized, sorted newest first. Columns: date, description, category (colored badge), amount (red for expense, green for income), flag icon if flagged. Inline category editing via dropdown — a manual edit sets `category_source = 'manual'` and updates the merchant cache.
- **Filters:** month picker, category filter, text search on description.
- All aggregates computed in SQL on the backend (SUM/GROUP BY), not in the frontend. Expose them via `GET /api/summary?month=YYYY-MM`.

### 4.4 Backend API (Module 1)
```
GET    /api/transactions?month=&category=&search=&page=
POST   /api/transactions            (single)
POST   /api/transactions/import     (array, from CSV mapping step)
PATCH  /api/transactions/:id        (edit fields incl. category)
DELETE /api/transactions/:id
GET    /api/summary?month=YYYY-MM   (totals + by-category + 6-month series)
GET/PUT /api/settings
```
- Validate all request bodies with `zod`. Return 400 with field-level messages on validation failure.
- All money in API payloads is integer cents. Field name must end in `_cents` to make this unmissable.

---

## 5. Module 2 — AI Auto-Categorization Engine (build second)

### 5.1 Categorization flow
Trigger: after CSV import completes, or via a "Categorize" button that targets all `Uncategorized` transactions. Steps per run:

1. **Cache pass:** for each transaction, compute `merchant_key`; if present in `merchant_category_cache`, assign immediately (`category_source = 'cache'`). No API call.
2. **Batch the remainder:** group uncached transactions into batches of **max 40 descriptions per API call**. Deduplicate identical merchant keys within a batch before sending.
3. **One Gemini call per batch**, sequential, with a 5-second delay between batches to stay under 15 RPM. Show progress in the UI ("Batch 2 of 4…").
4. Write results to transactions (`category_source = 'ai'`) and to the merchant cache.

### 5.2 Gemini prompt contract
System/prompt requirements:
- Provide the exact category list and instruct: respond with **only** a JSON array, no markdown fences, no commentary. Shape: `[{"i": <index>, "category": "<one of the list>"}]`.
- Set `generationConfig: { responseMimeType: "application/json", temperature: 0 }`.
- Include 3 few-shot examples in the prompt (e.g., `"NETFLIX.COM" → Subscriptions`, `"UBER *TRIP" → Transport`, `"PAYROLL DEPOSIT" → Income`).

### 5.3 Defensive parsing (mandatory)
- Strip markdown fences (```json … ```) before `JSON.parse` regardless of instructions.
- If parse fails: retry the batch once. If it fails again: assign `Uncategorized` to that batch and continue. Never crash the run.
- If Gemini returns a category not in the fixed list: map it to `Other`.
- Handle HTTP 429 (rate limit): exponential backoff (wait 15s, then 30s), max 3 attempts, then mark the remaining batches as skipped and tell the user they can re-run later. Handle 5xx similarly.
- Log every API call (timestamp, batch size, outcome) to a `logs/` file locally for debugging — never log the API key.

### 5.4 Anomaly flagging
Runs locally after categorization (no API call needed for the math):
- Flag a transaction if its expense amount exceeds **3× the median expense in its category** over the trailing 90 days (require ≥5 prior transactions in that category before flagging; otherwise skip).
- Flag any single expense exceeding **30% of `monthly_income_cents`** (if income is set).
- Store a human-readable `flag_reason`. Show flagged items in a dedicated dashboard section with a "dismiss" action (sets `flagged = 0`).

### 5.5 Budget suggestions
- Button: "Get budget suggestions." Requires `monthly_income_cents` to be set; otherwise prompt the user to set it.
- Backend assembles a compact summary (current month's per-category totals + income) — **send only aggregates to Gemini, never the raw transaction list** — and asks for 3–5 specific, actionable suggestions returned as a JSON array of strings.
- Render suggestions as a simple list. Same defensive parsing rules as 5.3.
- Cache the response per (month, data-hash) so repeated clicks don't burn quota.

### 5.6 Backend API (Module 2)
```
POST /api/categorize          (kicks off run; respond with run id)
GET  /api/categorize/status   (progress: batches done/total, errors)
POST /api/suggestions         (budget suggestions)
POST /api/flags/recompute
PATCH /api/flags/:id/dismiss
```

---

## 6. Module 3 — Smart Goal Tracking (build last, keep minimal)

- CRUD for goals (name, target amount, deadline).
- **Spending velocity:** average weekly net savings (income minus expenses) over the trailing 8 weeks.
- For each goal display: required weekly savings = remaining amount ÷ weeks until deadline; current velocity; on-track / behind status; projected completion date at current velocity (or "not reachable at current rate" if velocity ≤ 0).
- One progress bar per goal. No AI needed in v1 of this module.

---

## 7. Security & Data Handling Requirements (non-negotiable)

1. `.env` in `.gitignore` from commit #1. Provide `.env.example` with `GEMINI_API_KEY=your_key_here`.
2. Gemini is called only from the Express server. If any frontend code references the key or calls `generativelanguage.googleapis.com` directly, that is a defect.
3. Never send raw full transaction history to the AI. Categorization sends only description strings; suggestions send only aggregates.
4. SQLite file lives in `/server/data/budgetbrain.db`; add `/server/data/` to `.gitignore`.
5. Parameterized queries only (better-sqlite3 prepared statements). No string-concatenated SQL.
6. Sanitize CSV cell values before rendering (React escapes by default — do not use `dangerouslySetInnerHTML` anywhere).
7. Basic rate limit on the Express API (e.g., `express-rate-limit`) — cheap to add, good interview talking point.

---

## 8. Testing Requirements

Use Vitest. Minimum coverage targets (these are the interview-relevant tests):
- **Money math:** cents conversion both directions, rounding, negative handling.
- **CSV parsing:** each supported date format, parentheses negatives, debit/credit columns, malformed rows skipped, duplicate detection.
- **Merchant normalization:** `"WALMART #4521"` and `"Walmart #7788"` produce the same key.
- **Gemini response parsing:** valid JSON, fenced JSON, invalid category, garbage response → fallback path. Mock the API — no live calls in tests.
- **Anomaly logic:** boundary cases around the 3× median rule and the ≥5-transactions guard.

---

## 9. Build Order & Milestones

1. **M0 — Scaffold:** monorepo, Express + SQLite with migrations, Vite app, `dev` script, `.gitignore` + `.env.example`. Verify a health-check endpoint renders in the UI.
2. **M1 — Ledger:** manual CRUD → dashboard summary + charts → CSV import with mapping UI. Seed script with ~100 realistic fake transactions for development.
3. **M2 — AI engine:** cache table → batch categorization with progress UI → defensive parsing + retries → anomaly flags → budget suggestions.
4. **M3 — Goals:** goals CRUD + velocity math + progress display.
5. **M4 — Polish:** empty states, loading skeletons, error toasts, README with setup instructions and screenshots.

Each milestone must end with the app in a runnable, demoable state.

---

## 10. Explicit Non-Goals (v1)

- No user accounts / authentication (single local user).
- No bank API integrations (Plaid etc.) — CSV only.
- No deployment/hosting.
- No multi-currency support (single currency symbol from settings).
- No mobile app; responsive web layout is sufficient.

---

## 11. Acceptance Criteria (definition of done)

- [ ] `npm install && npm run dev` from a fresh clone (plus adding a Gemini key to `.env`) brings up the full app.
- [ ] Importing a 200-row CSV with mixed date formats succeeds via the mapping UI, with skipped-row reporting.
- [ ] Running categorization on 200 uncategorized transactions completes without hitting rate-limit failures (batching + delays observable in logs), and re-running it makes zero API calls for already-cached merchants.
- [ ] Killing the Gemini key (invalid key test) degrades gracefully: import still works, transactions land as `Uncategorized`, user sees a clear error message.
- [ ] All amounts render correctly to the cent; no floating-point artifacts anywhere in the UI.
- [ ] Repo history contains no API key at any commit.
- [ ] Test suite passes.
