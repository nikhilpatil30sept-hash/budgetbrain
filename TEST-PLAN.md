# BudgetBrain — QA Test Plan

**Version:** 2.0
**Date:** 2026-09-08 (v1.0: 2026-08-17)
**Tested build:** `main` branch — both the local development build and the deployed instance at `https://budgetbrain-m5y1.onrender.com`
**Tester:** Nick (solo)

**What changed in v2.0:** v1.0 described a local-only, single-user app with no automated tests. Since then the app has gained accounts, moved to a hosted database, been deployed, and acquired an automated suite of **169 unit/integration/component tests plus 17 end-to-end journeys run across 4 browsers**, all gated by CI. Sections 1, 3, 4, 5, 9 and 10 have been brought current; Sections 6 and 7 were already accurate.

---

## 1. Overview

BudgetBrain is a personal expense tracker. You type in what you spent and earned (or upload a CSV file exported from your bank), and it shows you where your money went this month with summary tiles, a colour-coded pie chart, and a six-month bar chart. It can also use Google's Gemini AI to automatically guess a category for each transaction ("TRADER JOE'S #552" → Groceries), point out unusually large purchases, suggest ways to cut spending, and track savings goals by telling you how much you need to put away each week.

Everyone has their own account, and each account's data is private to it.

**It runs in two places, and both are in scope.** Locally it stores everything in a SQLite file on your own machine. Deployed, the identical code talks to a hosted [Turso](https://turso.tech) database instead — same driver, same code path, no branching logic, so what you test locally is what runs in production. The live instance is at `https://budgetbrain-m5y1.onrender.com`.

The only data ever sent to Google is what the AI needs: merchant description strings for categorization, and per-category monthly totals for budget suggestions — never your full transaction history.

---

## 2. Objectives

1. **Verify functionality** — every feature listed in Section 3 does what a user would reasonably expect it to do.
2. **Verify graceful handling of invalid and edge-case input** — bad dates, empty fields, zero and negative amounts, oversized files, strange CSV layouts, and characters the app may not expect. The app should explain the problem, not crash or silently save wrong data.
3. **Verify financial calculations are accurate** — every total, percentage, average, and projection on screen must match what you get doing the same sum by hand or in a calculator.
4. **Verify safe behaviour when the Gemini AI is unavailable** — no key, an invalid key, an expired free-tier quota, or no internet. The app must keep working for everything that isn't AI, and must say clearly what went wrong.
5. **Track defects found** — every bug logged in a consistent, reproducible format (Section 7) so it can be fixed and re-tested.

---

## 3. Scope

### In scope

Everything below was confirmed by reading the actual code and the actual screens in this build — not the requirements document.

#### Module 1 — Ledger (transactions in and out)

- **Manual entry form** ("✏️ Jot one down" on the Dashboard) — date picker, description, amount, an expense/income toggle that decides whether the amount is a minus or a plus, and a category dropdown with 15 fixed categories.
- **Form validation before saving** — blocks empty descriptions, blocks amounts that aren't a positive number with at most two decimal places, and blocks dates in the future ("No fortune-telling — today or earlier!").
- **Optimistic display** — a new row appears in the list instantly, and disappears again if the server rejects it.
- **CSV import** (Import tab) — upload a `.csv` file or paste raw CSV text.
- **Column mapping step** — the app guesses which column is the date, description, and amount from the header names, and you can override every guess before anything is saved.
- **PDF statement import** (Import tab, "🧾 PDF statement") — upload a digital bank/credit-card statement PDF; the app extracts its text, crops out everything above the transaction table, redacts remaining identifier-shaped numbers/emails/phone numbers, shows you that masked text, then sends it to Gemini to extract `{date, description, amount}` rows — which then flow through the same mapping/preview/import screens as CSV. Scanned/image PDFs are rejected before any network call.
- **Two amount layouts** — one single amount column (negative = spending), or separate "debit" and "credit" columns.
- **"Expenses are positive numbers in this file" checkbox** — flips the sign for banks that export spending as positive numbers.
- **Date format choice** — a radio button for MM/DD/YYYY vs DD/MM/YYYY that becomes mandatory when the file contains dates like `03/04/2025` that could be read either way.
- **Preview table** — first 20 rows, with coloured tags showing which columns are being used as date / description / amount.
- **Import summary screen** — how many rows went in, a list of rows that were skipped and why, and a list of rows that look like duplicates.
- **1,000-row import cap** — enforced both in the browser and again on the server.
- **Transaction list** — 50 rows per page, newest first, with Previous/Next paging and a total count.
- **Filters** — month picker, category dropdown, and a search box that matches text inside descriptions (search waits ~0.3s after you stop typing before running).
- **Inline category editing** — click a category badge in the list to change it; this also teaches the app that merchant's category for next time.
- **Delete** — the ✕ on a row, with a confirmation pop-up.
- **API endpoints behind all of the above** — `GET/POST /api/transactions`, `POST /api/transactions/import`, `PATCH /api/transactions/:id`, `DELETE /api/transactions/:id`, `POST /api/extract-pdf`.

#### Module 2 — AI Categorization & anomaly flagging

- **"✨ Auto-label" button** on the Dashboard — finds every transaction still marked `Uncategorized` and asks Gemini to categorize them.
- **Merchant memory (cache)** — before calling the AI, the app checks a local table of merchants it has already seen. `WALMART #4521` and `Walmart #7788` are treated as the same merchant, so it only ever pays for that merchant once.
- **Batching and pacing** — up to 40 merchants per AI request, with a 5-second pause between requests to stay inside the free tier's limits.
- **Live progress** — a progress bar and "Batch 2 of 3…" text while a run is going, refreshed once a second.
- **One run at a time** — starting a second run while one is going returns a "already in progress" error.
- **"Auto-label them now" hand-off** — the button on the import summary screen that jumps to the Dashboard and immediately starts a categorization run.
- **Yellow "no key" banner** at the top of the app when no Gemini key is configured.
- **Anomaly flagging ("👀 Heads up — these stood out")** — highlights unusually large expenses, with a plain-English reason, and a "All good 👍" button to dismiss a flag permanently.
- **Budget coach ("🧞 Coach me")** — sends only this month's per-category totals and your monthly income to Gemini and returns 3–5 written suggestions; repeat clicks are served from a local cache and cost nothing.
- **API endpoints** — `POST /api/categorize`, `GET /api/categorize/status`, `POST /api/suggestions`, `POST /api/flags/recompute`, `PATCH /api/flags/:id/dismiss`.

#### Module 3 — Goals

- **Create a savings goal** — name, target amount, deadline date.
- **Progress bar and percentage** per goal.
- **"Your pace"** — average weekly net savings over the last 8 weeks, shown at the top of the page and on each goal.
- **"Needs $X/wk"** — how much you'd have to save weekly to hit the target by the deadline.
- **"Landing <date>"** — the projected finish date at your current pace, or "not at this pace 😅".
- **Status badge** — 🏆 You did it! / 🚀 On track / 🐢 A little behind / 🧗 Needs a bigger push, plus a "🔥 So close!" badge at 90%+.
- **The savings jar** — an animated 3D jar that fills as combined progress across all goals rises, with confetti at 90%.
- **Delete a goal** — the ✕ with a confirmation pop-up.
- **API endpoints** — `GET/POST /api/goals`, `PATCH /api/goals/:id`, `DELETE /api/goals/:id`.

#### Module 4 — Dashboard, Settings, and shell

- **Four summary tiles** — Spent this month, Earned this month, Net, and a count of flagged transactions, with numbers that count up when they change.
- **Category pie (donut)** — spending by category for the selected month, with total in the middle, a legend with amounts and percentages, and consistent colours + emoji per category.
- **Six-month spending bar chart** — the current month highlighted in orange.
- **Month picker** — changes the tiles, both charts, and the ledger together; can't be set to a future month.
- **Settings tab** — monthly income and currency symbol (up to 3 characters).
- **Tab navigation** — Dashboard / Import / Goals / Settings.
- **Server-down screen** — "😴 The server's not answering" with a Try again button.
- **Toast notifications** for successes and errors throughout.
- **Health check** — `GET /api/health`, which also reports whether a Gemini key is configured.
- **Rate limiting** — the API accepts a maximum of 300 requests per minute **in production**; outside production the limit is raised to 2,000/min, and the tighter `/api/auth/*` limit likewise goes from 20 per 15 minutes to 1,000. This is deliberate: a full cross-browser Playwright run generates far more traffic from one address than any real user would, and the production limits used to make CI fail with `429`s that looked exactly like flaky timing (see Section 8).

#### Module 5 — Authentication

- **Sign up** — email + password (minimum 8 characters); a friendly, on-brand form matching the rest of the app's style.
- **Every account is private** — each signup gets its own empty ledger, goals, and settings. The one exception: whichever account signs up *first* automatically inherits any pre-existing data from before login existed (see the README's "Legacy data" note) — every account after that starts genuinely empty.
- **Log in / log out** — session-cookie based (not a token you can copy out of the browser). Logging out ends the session server-side, not just in the browser.
- **Forgot password** — always shows the same "if an account exists…" message whether or not the email is real, so the form can't be used to find out who has an account. The actual reset link is emailed (if `RESEND_API_KEY` is configured) or printed to the server's console (if it isn't).
- **Reset link** — a one-hour, single-use link (`?reset_token=...`) that sets a new password and logs you straight back in; using the same link twice fails the second time.
- **Every other screen requires a session** — Dashboard, Import, Goals, and Settings all 401 without one; the app shows the login screen instead of any of them until you're signed in.
- **API endpoints** — `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`.

### Out of scope

Six items that were out of scope in v1.0 have since moved **into** scope — multi-browser, mobile viewport, deployment, automated suites, accessibility, and load testing all now have coverage (Section 5). What remains genuinely out of scope:

- **Penetration and security testing** — no attempts to break in, inject SQL, or deliberately bypass the rate limit. Security *headers* are now automatically verified (`security.test.ts`) and the app's own defences are documented in the README, but nobody has actively attacked this app.
- **Performance at scale** — the load script in Section 8 is a smoke test against one small instance. Nothing has been tested with tens of thousands of transactions, or with many genuinely simultaneous users.
- **Real device testing** — a Pixel 5 *viewport* runs in the automated suite, but no test has run on physical phone or tablet hardware. Emulated viewport is not the same as a real device.
- **Gemini's answer quality** — whether "STARBUCKS" is *better* labelled Dining or Other is a judgement call, not a defect. What we test is that the app handles whatever comes back safely.
- **The 3D savings jar's visual fidelity** — animation smoothness and graphics are cosmetic; only "does it appear and roughly track progress" is checked.
- **A full accessibility audit** — the axe-core scan (Section 5) catches *serious* and *critical* automated violations only. Screen-reader testing, full keyboard-only walkthroughs, and the moderate-severity findings axe reports are all still uncovered.
- **Visual regression testing** — nothing compares screenshots between runs, so a purely visual break would pass every automated check.
- **Email delivery** — password-reset emails are tested up to the point of generating the link. Whether Resend actually delivers to a real inbox is not tested.

---

## 4. Test Environment

| Item | Value |
|---|---|
| Operating system | macOS 26.5.2 (Apple Silicon) |
| Runtime | Node.js v22.23.2 locally; **Node 24** on the CI runners (Ubuntu) |
| Browsers — manual | Chrome (latest), desktop window |
| Browsers — automated | Chromium, Firefox, WebKit/Safari, and a Pixel 5 mobile viewport, all via Playwright |
| Project location | `/Users/nick/budgetbrain` |
| Start command | `npm install` once, then `npm run dev` from the project root |
| App URL (what you test) | **http://localhost:5173** |
| API URL (behind the scenes) | http://localhost:3001 — you only visit this directly for the API testing phase |
| **Production URL** | **https://budgetbrain-m5y1.onrender.com** — deployed automatically from the `main` branch. Free tier, so it sleeps after 15 minutes idle and the first request afterwards takes about a minute. |
| Database — local | SQLite, a single file at `server/data/budgetbrain.db`. Deleting this file resets the app to empty; it is recreated automatically on the next start. |
| Database — production | Hosted [Turso](https://turso.tech) (libSQL), reached with the same `@libsql/client` driver and the same code path — set via `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`. |
| Database — automated tests | An in-memory database per run (`DATABASE_PATH=:memory:`, set in `server/vitest.setup.ts`), wiped between every test by `resetDb()`. Never touches your real data. |
| CI | GitHub Actions, `.github/workflows/ci.yml`, on every push and pull request to any branch. |
| AI service | Google Gemini free tier, model `gemini-3.5-flash-lite` (overridable via `GEMINI_MODEL`) |
| AI call log | `server/logs/gemini.log` — one line per AI call with a timestamp and outcome. Useful for confirming whether a call actually happened or came from the cache. The key is never written here. |

### Starting the app

1. Open Terminal and go to the project folder: `cd /Users/nick/budgetbrain`
2. Run `npm install` (only needed the first time, or after code changes that add libraries).
3. Run `npm run dev`. This starts **both** halves of the app at once — the data server on port 3001 and the web page on port 5173.
4. Open **http://localhost:5173** in Chrome. You'll land on the login screen — sign up with any email/password (8+ characters) to create your own account, or log in with the seeded demo account below if you've already run `npm run seed`.
5. To stop, press `Ctrl + C` in that Terminal window.

### Adding a Gemini API key (needed for the AI features)

1. Get a free key from https://aistudio.google.com/apikey
2. In Terminal, from the project folder, run: `cp server/.env.example server/.env`
3. Open `server/.env` in a text editor. Replace `your_key_here` with your real key so the line reads `GEMINI_API_KEY=AIza...`
4. **Stop and restart `npm run dev`.** The key is only read when the server starts, so an edit made while it's running has no effect until you restart.
5. Confirm it worked: the yellow "🔮 No Gemini key yet" banner at the top of the app should be gone after a refresh.

To test the "no AI available" scenarios, either delete `server/.env`, or set the key to something invalid — and restart the server each time.

### Loading sample data (optional)

`npm run seed` fills the database with about 100 realistic fake transactions across the last five months, sets monthly income to $5,200, deliberately leaves the last ~12 days uncategorized so the ✨ Auto-label button has something to do, and plants two deliberately oversized purchases (an $850 dinner and a $1,799 Apple purchase) so the anomaly flags have something to catch. It seeds one account — `demo@budgetbrain.local` / `password123` by default (pass a different email as an argument, e.g. `npm run seed -- me@example.com`, to seed a different account instead).

⚠️ **`npm run seed` erases all existing transactions, the merchant memory, and the cached coach suggestions.** It does *not* erase goals. Don't run it in the middle of a test unless you mean to start over.

---

## 5. Types of Testing Planned

| Type | Status | What it covers |
|---|---|---|
| **Manual functional testing** | Done — see `TEST-CASES.md` | Walking through every feature in Section 3 by hand against a written test case list, confirming each one behaves as expected. Cases BB-1 to BB-8 were executed by hand at both the UI and API layers and their results recorded. |
| **Exploratory testing** | Done | Unscripted poking around — deliberately unusual input, odd click orders, rapid clicking — aimed at the risk areas in Section 6. BB-4 (typed negative amount) came out of this and is recorded as an exploratory case rather than a strict pass/fail. |
| **API testing (Postman / curl)** | Done — manual | Calling the endpoints directly, bypassing the web page, to check the server rejects bad data on its own rather than relying on the browser form. This matters because the browser's checks and the server's checks are written separately and can disagree. Done as practice with the tool; no saved `.postman_collection.json` exists — the same ground is now covered repeatably by the automated integration suite below. |
| **Unit testing (Vitest)** | Automated — **56 tests** | Pure functions, no database and no network. Server (38): merchant-name normalization, the anomaly boundary rules, password/token hashing, and Gemini response parsing with the network mocked. Client (18): money formatting and parsing, and CSV amount/date parsing. The parsing and rule logic was deliberately extracted into small standalone modules so it could be tested this way. |
| **Integration testing (Vitest + Supertest)** | Automated — **93 tests** | Real HTTP requests through the whole Express app — routing, security headers, rate limiting, session checks, validation — into a real database, with no port bound and no browser. Covers auth, transactions, goals, settings, the dashboard summary maths, the AI orchestration routes, and cross-user data isolation. The largest and highest-value group in the suite. |
| **Component testing (React Testing Library + jsdom)** | Automated — **20 tests** | React components rendered and driven in a simulated DOM, queried the way a user perceives them (by visible label and accessible role, never by CSS class). Covers the transaction form's validation states, the categorization progress panel, the goal creation form and progress bar, and the CSV import UI. |
| **End-to-end testing (Playwright)** | Automated — **17 journeys × 4 browsers = 68 runs** | Real browsers driving the real app against a real server and database. Covers signup/login/logout/session persistence (BB-A1 to BB-A5), adding a transaction and its effect on the monthly total (BB-1), four validation-rejection cases (BB-2, BB-4, BB-5, BB-6), long-description layout (BB-7), and persistence across a refresh (BB-8). Runs serially (`workers: 1`) because every spec shares one server and database — a deliberate trade of speed for correctness. |
| **Cross-browser & responsive** | Automated | Every end-to-end journey runs on Chromium, Firefox, WebKit/Safari and a Pixel 5 viewport. Enabling these is what surfaced the rate-limiting defect described in Section 8. Real physical devices remain out of scope. |
| **Accessibility testing (axe-core)** | Automated smoke test | `e2e/tests/accessibility.spec.ts` runs `@axe-core/playwright` against the login page, the dashboard, and the transaction form, failing on any *serious* or *critical* violation. Its first run found five genuine WCAG AA colour-contrast failures (the primary button was at 2.83:1 against a 4.5:1 requirement) and one keyboard trap in the donut chart. This is a floor, not a full audit — see the known limitation below. |
| **Security headers (helmet)** | Automated — 4 tests | `helmet` sets the response headers that tell browsers not to sniff content types, not to allow framing, and not to advertise the server software. `server/src/__tests__/security.test.ts` asserts they genuinely arrive, including on a 404 — middleware nobody tests is middleware that can silently stop working. |
| **Static analysis (ESLint + TypeScript)** | Automated in CI | One flat ESLint config for the whole monorepo, with Node globals for the server, browser and React-hooks rules for the client, and relaxed `any` rules inside test files. A clean `tsc` compile is a separate CI gate. Neither runs the code — they read it, which is why they run first. |
| **Dependency vulnerability audit (`npm audit`)** | Automated in CI | Scans dependencies against the public advisory database. Scoped to production dependencies (`--omit=dev`), because the gate exists to catch what actually reaches a user — a dev-only load-testing tool's transitive advisory is not that, and a gate that fires on harmless things trains people to ignore it. |
| **Load & concurrency (autocannon)** | Manual, documented | Not in CI. See Section 8 for the script, how to run it, and what a healthy result looks like. |
| **Continuous integration** | Automated — GitHub Actions | Everything above except the manual and load rows runs on every push, ordered cheapest-first so a compile error costs seconds rather than minutes: install → lint → audit → build → unit and integration tests with coverage → seed → browser tests. Coverage and Playwright reports upload as build artifacts either way, so a failure can be read without reproducing it. `main` deploys to Render, so this pipeline is the last thing between a bad commit and production. |

**Coverage, as measured by Vitest's v8 provider:** server **86% statements / 75% branches**, client **72% statements / 64% branches**. Branch coverage is the more honest figure — it asks whether both outcomes of each decision were exercised, not merely whether a line was reached. Coverage proves code *ran*; it never proves the assertions were meaningful.

**Known limitation — accessibility:** the app's decorative background (`Backdrop.tsx`) is four large, perpetually-drifting colour blobs behind the *entire* app, and `Card` (`.glass` in `client/src/index.css`) is a translucent `bg-white/60` surface over it. Muted (`ink-400`) text near the top of any page can therefore pass or fail contrast depending on exactly where the blobs are drifting when the scan runs. Every instance axe has caught (`App.tsx`'s tagline, `SummaryCards.tsx`'s "flagged" count, `CategorizePanel.tsx`'s "waiting for a label") was raised to `ink-900`, which clears the threshold with real margin regardless of blob position — but that is a reactive, spot-by-spot fix, so newly added UI near the top of a page could trip the same failure again. A structural fix exists (lower the blob opacity, or make `.glass` less translucent) but is a visual-design change judged out of scope.

---

## 6. High-Risk Areas

These are the specific places most likely to contain bugs, based on how the app is actually built. Each one names the real rule and suggests what to try.

### 6.1 Dates in CSV files

The importer only understands five date shapes: `2026-06-01`, `06/01/2026`, `01/06/2026`, `01-06-2026`, and `Jun 1, 2026` (three-letter or full month names).

- **Two-digit years are not supported at all.** A file with `06/01/26` will reject *every single row* with "unsupported date format". Many real bank exports use two-digit years, so this is the most likely thing to make an entire import fail.
- **The mandatory MM/DD vs DD/MM choice is decided by looking at only the first 200 rows.** If a 500-row file has clear dates near the top (like `25/12/2025`, which can only be day-first) but an ambiguous one like `03/04/2025` at row 400, the app won't force you to pick a format — it will just skip that one row with an "ambiguous date" message. Try a long file with a late ambiguous date.
- **Getting the MM/DD vs DD/MM choice wrong is silent.** Choosing MM/DD on a day-first file turns 3 April into 4 March with no warning, and the money lands in the wrong month. Test that the preview and the resulting dashboard month actually match what you intended.
- **Impossible dates** like `2026-02-30` or `31/02/2026` should be rejected as invalid — check they are, rather than rolling over into March.

### 6.2 The "no future dates" rule and your time zone

Both the form and the server compare against today's date **in UTC time**, not local time. Late in the evening in a time zone behind UTC (or early morning ahead of it), the app's idea of "today" can be a different day from your computer's. Try adding a transaction dated today late at night and near midnight, and check the date picker doesn't refuse a date you'd consider valid, or accept one you'd consider tomorrow.

Also worth checking: the future-date rule applies to **manual entry and imported rows**, but **goal deadlines are not checked at all on the server**. The date picker on the Goals page has a "no earlier than today" limit, but the API itself will happily accept a deadline in 2020. A goal with a past deadline shows "— (past deadline)" where the weekly amount should be — confirm that reads sensibly rather than looking broken.

### 6.3 Amounts and currency symbols

- The importer strips `$ € £ ¥` , spaces, and thousands separators before reading a number. **It does not recognise `₹`, `₩`, `R$`, `CHF`, or any other symbol.** Meanwhile, Settings lets you set the currency symbol to anything up to 3 characters, including `₹`. So you can set the app to rupees and then find that a rupee-denominated CSV fails on every row with "unparseable amount". Test that combination.
- The **manual entry box** is stricter still — it only strips `$`, commas, and spaces. Typing `€50` there fails, and so does typing `-25` (you're expected to use the 💸 spent / 💰 earned toggle instead of a minus sign). Check the error message actually explains that.
- **Brackets mean negative** in CSV files: `(45.23)` is read as −$45.23. Test a file that uses that convention.
- **More than two decimal places is rejected**, not rounded — `10.999` is a skipped row, not $11.00.
- **Zero amounts are rejected** everywhere. A CSV row of `0.00` is skipped with "amount is zero".
- Setting the currency symbol **only changes the symbol shown** — no conversion happens. Confirm nothing implies otherwise.

### 6.4 The debit/credit two-column mode

When you pick "Separate debit / credit columns", a row is only valid if **exactly one** of the two has a value. A row with both filled in is skipped ("both debit and credit are set"), and so is a row with neither. Many bank exports put `0.00` in the unused column rather than leaving it blank — those files will fail on every row. This is worth testing specifically because the error message won't obviously point at that cause.

### 6.5 Duplicate detection

A row is called a duplicate when an existing transaction has the **same date, the same amount, and the same simplified merchant name**. The simplified name is made by lowercasing and deleting all digits and punctuation, so `AMAZON.COM*4A2B` and `Amazon com 99` are considered the same merchant.

- **Duplicates are imported anyway**, on purpose — they're only reported as a warning. Confirm the warning is visible enough that you'd notice, and that importing the exact same file twice results in doubled totals as expected.
- **The reported row numbers can be wrong.** Rows rejected in the browser are numbered by their position in the original file; rows rejected by the server are numbered by their position in the smaller, already-filtered batch that got sent. When any rows are skipped in the browser, "row 12 (server)" in the summary refers to a *different line* than row 12 in your spreadsheet. Test with a file that has a bad row near the top plus a duplicate further down, and check whether the row numbers point where you'd expect.
- Two genuinely different purchases at the same shop, on the same day, for the same amount (two identical coffees) will be reported as duplicates. That's expected behaviour, not a bug — but check the wording doesn't sound like an accusation.

### 6.6 Anomaly flagging boundaries

There are exactly two flagging rules, and both are *strictly greater than* comparisons:

1. **Category median rule** — an expense is flagged if it is more than 3× the median expense in the *same category* over the previous 90 days, and only if there are **at least 5 earlier transactions** in that category within that window. A 6th transaction triggers the rule; a 5th does not. An expense exactly 3× the median is **not** flagged.
2. **Income rule** — any single expense more than 30% of your monthly income is flagged. Exactly 30.0% is not flagged. If monthly income is blank, this rule is switched off entirely.

Things to probe:
- **`Uncategorized` transactions are deliberately excluded from rule 1**, so an enormous uncategorized purchase only gets flagged if it also crosses the 30%-of-income line. Test a huge uncategorized expense with income unset — nothing should flag, which may look like a bug but is intentional.
- **Income and Transfers are never flagged**, and neither is any positive amount.
- **Flags do not refresh on their own.** They are only recalculated at the end of a Gemini categorization run — nothing else in the app triggers a recalculation, and there is **no button anywhere in the UI** that does it. So: add a $2,000 expense by hand, and it will *not* be flagged, no matter how obviously it qualifies, until you happen to run Auto-label. Likewise, changing your monthly income in Settings does not re-evaluate existing transactions. This is the single most likely source of "the flags are wrong" reports, and it can only be forced manually by calling `POST /api/flags/recompute` in the API testing phase.
- **Dismissing a flag is permanent for that transaction.** Once you click "All good 👍", that transaction can never be flagged again, even if you later change its amount or your income. Verify that's acceptable.
- The **"Worth a look" tile counts flagged transactions across all time**, while the other three tiles next to it are for the selected month only. Switching the month changes three tiles but not the fourth. Confirm whether that reads as broken.

### 6.7 Behaviour when the Gemini key is missing, wrong, or rate-limited

- **No key at all** — the yellow banner appears, and clicking ✨ Auto-label leaves everything `Uncategorized` with a clear message. Everything non-AI must still work fully. Test the whole app in this state.
- **An invalid or revoked key** — this is the riskier case, because the app only checks that the key box *isn't empty*. With a made-up key like `abc123`, **the yellow banner does not appear**, so the app looks healthy until you actually click a button; only then do you get "Gemini API key missing or invalid". Check that message appears in both places it can happen: the Auto-label run and the "Coach me" button.
- **Rate limits and server errors** — on a rate-limit or outage, the app waits **15 seconds, then 30 seconds**, before giving up. During that time the progress bar just sits there with no explanation for up to 45+ seconds, which looks like a freeze. Confirm it eventually shows a real message and doesn't leave the button stuck on "Sorting the pile…". The free tier is easy to exhaust, so this is likely to come up naturally.
- **When a run gives up partway**, the transactions it already handled keep their new categories and the rest stay `Uncategorized` — re-running later should only cost API calls for the ones still missing. Verify a second run is cheap by checking `server/logs/gemini.log`.
- **A nonsense AI response** is retried once, then those transactions are left `Uncategorized` rather than being given a wrong category. Any category the AI invents that isn't one of the 15 allowed ones is quietly turned into "Other" — so if you see a suspicious cluster of "Other", that's why.
- **Run progress is held in the server's memory, not in the database.** If the server restarts mid-run (which happens automatically whenever a code file is saved), the progress bar's information is lost and the status resets to idle even though work may have stopped halfway. Test by stopping and restarting `npm run dev` during a long run.

### 6.8 The merchant memory

Every time you change a category by hand, the app records "this merchant means this category" and uses it for all future categorizations — skipping the AI entirely for that merchant.

- **It only applies going forward.** Correcting one Netflix charge does not fix the other Netflix charges already in your list. Users will likely expect it to.
- **The simplification is aggressive**: digits and punctuation are deleted, so `7-ELEVEN` becomes "eleven", and `SQ *BLUE BOTTLE` becomes "sq blue bottle". A description made only of numbers (`4829571`) simplifies to nothing at all and gets silently skipped by the categorizer — it will just never get a label. Try one.
- **The name is cut off at 40 characters**, so two long merchant names that only differ near the end are treated as the same merchant.
- The memory is only cleared by `npm run seed` or by deleting the database file. If an AI mistake gets recorded, it will keep repeating until then.

### 6.9 The search box

Search is a plain "contains this text" match with **no protection for wildcard characters**. In this kind of database search, `%` means "anything" and `_` means "any one character". So searching for `50%` matches things you wouldn't expect, and searching `_` matches almost everything. Worth confirming what actually happens.

Also note search only looks at the **description**, never the category or the amount, and it always combines with the currently selected month — so a search that "finds nothing" may just be the month filter.

### 6.10 Goal maths

- **All goals share one pot.** Progress toward a goal is calculated as *total income minus total expenses since the day that goal was created*, across your whole account. There is no way to put money into a specific goal. So two goals created on the same day will always show the identical amount saved, and creating a third doesn't divide anything up. Test with three goals and confirm the numbers don't imply otherwise.
- **Progress is capped between 0 and the target.** If you spent more than you earned since creating a goal, the bar sits at 0%, not a negative number.
- **"Your pace" is the average over the last 8 weeks**, including large one-off items. One big payday or one big purchase noticeably swings it, which in turn swings the "Landing" date and the on-track/behind badge. Compare the figure against the ledger by hand.
- **A negative pace means "Landing" shows "not at this pace 😅"** and the status becomes "🧗 Needs a bigger push". A brand-new database with no income at all will put every goal in that state.
- **Weeks left is calculated in UTC**, same time-zone caveat as 6.2, and is rounded to one decimal — a deadline of "tomorrow" may read as 0.1 weeks.

### 6.11 Money display and rounding

Every amount is stored as a whole number of cents and only converted to dollars at the moment it's shown, specifically to avoid rounding errors. This should be checked rather than assumed:

- Add several amounts ending in `.01`, `.05`, and `.99` and confirm the tile totals match a calculator exactly.
- Check the pie chart percentages — they're each rounded to a whole number independently, so they may add up to 99% or 101%.
- Check the bar chart's axis labels, which shorten to forms like `$1.2k`, against the exact values in the tooltip.
- Confirm the **Net** tile equals Earned minus Spent exactly.
- Confirm **Transfers are excluded** from Spent, Earned, Net, both charts, the goal pace, and the anomaly rules. Add a transaction categorized as Transfers and check every number stays put.

### 6.12 Rate limiting and rapid clicking

The server accepts 300 requests per minute. While a categorization run is going, the page checks progress once a second on its own, on top of everything else. Rapidly switching months, typing in search, and clicking buttons during a run could push past the limit, at which point requests start failing with confusing errors. Try to provoke it.

### 6.13 CSV files that aren't quite CSV

- A file with **fewer than two columns** is rejected with a clear message — check it.
- A file with **no header row** will treat your first transaction as the column names, silently losing it. Try it.
- **Excel exports saved as UTF-16 or with a byte-order mark** may produce a garbled first column name — worth one test with a file saved straight out of Excel rather than hand-typed.
- **Duplicate column headers** (two columns both called "Amount") are automatically renamed behind the scenes, which may make the dropdowns confusing.
- **Over 1,000 rows** is refused up front with a message telling you to split the file — confirm at 1,000 and 1,001 rows.
- Blank lines at the end of a file are ignored rather than being reported as errors.

### 6.14 Cosmetic but confusing

- Every imported row is recorded as having been categorized "manually", even though you never chose anything — hovering a category badge on an imported row says "Labeled by: manual". Minor, but it's misleading.
- The "waiting for a label" count next to the ✨ button counts **all** uncategorized transactions across all time, not just the selected month, so it won't match what you see in a filtered list.
- The "Coach me" suggestions are cached per month **and** per set of numbers — adding a single transaction changes the numbers and so causes a fresh AI call, while clicking twice in a row does not. Verify against `server/logs/gemini.log`.

### 6.15 PDF statement import

This is the one feature where meaningful statement content — not just short strings — leaves the browser toward a third party (Gemini), so it deserves closer scrutiny than a typical feature.

- **Scanned/photographed PDFs must be rejected before any network call.** The app checks for a real text layer (via `pdfjs-dist`) and refuses anything near-empty with a clear "looks like a scanned or image PDF" message. Test with an actual scan or a screenshot saved as a PDF — confirm it's rejected client-side and that no request to `/api/extract-pdf` ever fires (check the Network tab).
- **The transaction-table boundary is a heuristic, not a guarantee.** The app looks for a header row naming the usual columns (Date/Description/Amount/etc.), falling back to a run of several date-like lines in a row. An unusual statement layout can fool this in either direction — cropping too early (losing real transactions) or not finding a boundary at all. When the boundary isn't found, the whole document is redacted in place instead of cropped, and the UI shows an explicit warning banner ("couldn't automatically find where your transaction list starts") — test with a statement whose layout doesn't match common patterns and confirm that warning actually appears, and that the identifier redaction still ran.
- **Always review the "what we'll send to the AI" preview before trusting it.** The redaction only targets long (9+ digit) number runs, SIN/SSN shapes, emails, and phone numbers — it will not catch, say, a name embedded inside the transaction table itself (rare, but possible on some statement formats). This preview step exists precisely so a human confirms nothing sensitive slipped through; don't treat auto-redaction as infallible.
- **Extracted dates/amounts go through the same parser as CSV.** Gemini is asked to echo dates exactly as printed rather than resolve them itself, so a PDF with yearless dates (`Jul 23`) still triggers the statement-year picker, and an ambiguous numeric date (`03/04/2025`) still triggers the MM/DD vs DD/MM radio — same rules as §6.1. Test a PDF with yearless dates and confirm the picker appears and is required, same as CSV.
- **A statement whose masked text exceeds ~60,000 characters is rejected with a 400** asking the user to split the PDF into a smaller date range, rather than silently truncating (which would corrupt the last few transactions). Test with a very long, multi-year statement.
- **A zero-result extraction is a visible error, not a silent no-op.** If Gemini returns no usable rows (e.g. the cropped text genuinely had no transactions), the endpoint returns a clear error rather than an empty success that would look like "nothing to import."

---

## 7. Defect Tracking

Every bug found is logged as a **GitHub Issue** on this repository, one issue per bug, containing:

| Field | What goes in it |
|---|---|
| **Title** | A short, specific summary — "CSV import fails on all rows when dates use 2-digit years", not "import broken". |
| **Steps to reproduce** | Numbered steps someone else can follow from a fresh start, including any file or data used. Attach the CSV file if one was involved. |
| **Expected result** | What should have happened. |
| **Actual result** | What actually happened, word for word where there's an error message. |
| **Severity** | **Critical** — data loss, wrong money totals, or the app won't run. **High** — a main feature doesn't work and there's no way around it. **Medium** — a feature misbehaves but there's a workaround. **Low** — cosmetic, wording, or layout. |
| **Screenshot** | A screenshot or short screen recording of the problem. |

Add the label `bug`, plus the module it belongs to (`ledger`, `ai`, `goals`, `dashboard`).

---

## 8. Load & Concurrency Smoke Testing

Not part of the automated CI suite — CI's Vitest integration tests talk to the Express `app` object directly via `supertest`, with no real port bound, so there's no live server for a load-generating tool to actually hit. This is a separate, manually-run script against a real running instance instead.

**What it is:** `server/scripts/loadtest.mjs`, using [autocannon](https://github.com/mcollina/autocannon)'s programmatic API. It logs in once as the seeded demo account (reusing that session cookie for every authenticated request, the way a real browser session behaves) and then runs three short phases: the public `/api/health` endpoint (baseline, no DB), an authenticated `GET /api/transactions` (a DB read), and an authenticated `GET /api/summary` (a DB aggregation query).

**How to run it:**

```bash
# Terminal 1, from the repo root — start the app
npm run dev

# Terminal 2, from the repo root — once, so the demo account exists
npm run seed

# Terminal 2 — run the load test itself
npm run loadtest -w server
```

Optional env vars (all have sane defaults): `BASE_URL` (default `http://localhost:3001`), `CONNECTIONS` (default `10`), `DURATION` in seconds per phase (default `10`).

**What a healthy result looks like:** `0` timeouts, `0` non-2xx responses, and p99 latency in the tens of milliseconds. This is a single small free-tier-shaped instance, not a production cluster — the point of running this repeatably isn't chasing a specific throughput number, it's catching a regression that makes these numbers suddenly much worse (for example, the earlier bug where a Playwright CI run's cumulative traffic could exhaust the rate limiter and start returning `429`s — the same category of problem this script would also catch against a real running instance, not just in CI).

---

## 9. Entry & Exit Criteria

### Entry criteria — testing starts only once all of these are true

1. `npm install` completes without errors.
2. `npm run build` completes without errors.
3. **`npm test` passes** — all 169 unit, integration and component tests green.
4. **`npm run lint` reports no errors.**
5. **The CI pipeline is green on the branch under test.** Since `main` deploys automatically, a red pipeline means nothing is ready to test.
6. `npm run dev` starts both halves of the app with no errors in the Terminal.
7. http://localhost:5173 loads and shows the login screen (or the Dashboard, if already signed in) — not the "😴 The server's not answering" screen.
8. A Gemini API key is configured and the yellow "no key" banner is gone (a separate deliberate no-key pass comes later).
9. The test case list (`TEST-CASES.md`) is written and reviewed.
10. The database is in a known state — either freshly seeded with `npm run seed`, or freshly emptied.

### Exit criteria — testing is finished when all of these are true

1. Every test case in `TEST-CASES.md` has been run and marked Pass, Fail, or Blocked.
2. Every **Critical** and **High** severity bug is fixed and re-tested as passing.
3. **Every fixed bug has left behind an automated regression test**, so it cannot silently return. (Applied so far to the legacy-data concurrency bug, the long-description layout bug, and the rate-limiting defect.)
4. Every remaining **Medium** and **Low** bug is logged as a GitHub Issue with an agreed decision to fix later or accept.
5. All four modules (Ledger, AI Categorization, Goals, Dashboard) have been tested both **with** a working Gemini key and **without** one.
6. Every calculation listed in Section 6.11 has been verified by hand against a calculator.
7. **The full automated suite passes on all four browsers**, and CI is green on the branch being released.
8. The final testing summary (Section 10) is written.

---

## 10. Deliverables

1. ✅ **This test plan** (`TEST-PLAN.md`) — what will be tested, where, and what the biggest risks are.
2. ✅ **A test case list** (`TEST-CASES.md`) — the individual step-by-step checks, each with its steps, expected result, the manual result recorded, and which automated suite now covers it.
3. ✅ **An automated test suite** — 169 unit, integration and component tests plus 17 end-to-end journeys across 4 browsers, all runnable with `npm test` and `npx playwright test`, and all gated by CI on every push.
4. ✅ **A CI pipeline** (`.github/workflows/ci.yml`) — the automated gate described in Section 5, publishing coverage and Playwright reports as build artifacts.
5. ✅ **A load-test script** (`server/scripts/loadtest.mjs`) — documented in Section 8 so it can be re-run consistently.
6. **Logged bugs** — GitHub Issues in the format set out in Section 7, one per defect.
7. ⬜ **A final testing summary** (`TEST-SUMMARY.md`) — how many test cases were run and how many passed, a list of the bugs found grouped by severity, which areas are solid, which areas are still risky, and a plain recommendation on whether the app is ready to be deployed. **Not yet written.**
