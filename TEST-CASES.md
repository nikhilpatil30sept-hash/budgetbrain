# BudgetBrain — Manual Test Cases

**Source:** written and manually executed by Nick against the local dev build described in [TEST-PLAN.md](TEST-PLAN.md), verified at both the UI layer (manual browser testing) and the API layer (Postman / curl, hitting the backend directly).
**Purpose:** one record per test case — steps, expected result, and what was actually observed — used both to track manual QA coverage and as the source material for the Playwright suite in `e2e/tests/`.

**Last updated:** after the test-coverage checklist was completed — every ledger case below now has automated coverage.

**Status legend**
- *Manual result* — what happened when this case was actually run by hand, at whichever layer(s) were tested.
- *Automated* — which automated suites now cover this case. **UI** means a Playwright spec drives the real browser; **API** means a Vitest/Supertest test hits the endpoint directly. Several cases are enforced at both layers independently, and are covered at both.

## Summary

| ID | Title | Manual result | Automated |
|----|-------|----------------|-----------|
| BB-1 | Add a valid transaction successfully | PASS (UI + API) | ✅ UI — `e2e/tests/manual-transaction-entry.spec.ts` |
| BB-2 | Reject zero-amount transaction | PASS (UI + API) | ✅ UI — `e2e/tests/transaction-validation.spec.ts` · ✅ API — `transactions.integration.test.ts` |
| BB-4 | Reject or handle negative amount | PASS — exploratory, both layers behave sensibly | ✅ UI — `e2e/tests/transaction-validation.spec.ts` |
| BB-5 | Add a transaction with a future date | PASS (UI + API) | ✅ UI — `e2e/tests/transaction-validation.spec.ts` · ✅ API — `transactions.integration.test.ts` |
| BB-6 | Reject transaction with empty description | PASS (UI + API) | ✅ UI — `e2e/tests/transaction-validation.spec.ts` |
| BB-7 | Add a transaction with an unusually long description | FAILED → FIXED → PASS (UI + API) | ✅ UI — `e2e/tests/transaction-layout.spec.ts` |
| BB-8 | Transaction persists after page refresh | PASS (UI + API, triple-verified) | ✅ UI — `e2e/tests/transaction-persistence.spec.ts` |
| BB-A1 | Sign up, land on an empty dashboard, log back in with data intact | Not run by hand — see note | ✅ UI — `e2e/tests/auth.spec.ts` |
| BB-A2 | Signing up with an email that already has an account is rejected | Not run by hand — see note | ✅ UI — `e2e/tests/auth.spec.ts` |
| BB-A3 | Wrong password rejected without revealing whether the email exists | Not run by hand — see note | ✅ UI — `e2e/tests/auth.spec.ts` |
| BB-A4 | Unauthenticated visitor sees the login screen, not the dashboard | Not run by hand — see note | ✅ UI — `e2e/tests/auth.spec.ts` |
| BB-A5 | A logged-in session survives a page refresh | Not run by hand — see note | ✅ UI — `e2e/tests/auth.spec.ts` |

*BB-3 was not included in what you gave me — left out rather than invented.*

*The BB-A\* authentication cases were written directly as Playwright specs when login was added, rather than being executed by hand first. They are recorded here so the document covers the whole suite, but their "manual result" is honestly blank — they have never been run as manual test cases.*

---

## BB-1 — Add a valid transaction successfully

**Pre-condition:** App running locally, dashboard visible with "Add Transaction" form.

- **Given** — user is on the dashboard with the form visible
- **When** — enters today's date, description "Coffee", amount "$4.50", selects Expense, clicks Save
- **Then** — transaction appears in the list with correct date/description/amount, styled as an expense
- **And** — "Spent this month" total increases by exactly $4.50

**Post-condition:** transaction saved to DB and visible in the list.

**Manual result:** PASS (UI + API).
- UI: all 4 steps verified manually. "Spent this month" total increased by exactly $4.50 after adding "Coffee".
- API: `POST /api/transactions` with a valid body returned 201; transaction persisted, confirmed via an independent GET.

**Automated:** ✅ UI — `e2e/tests/manual-transaction-entry.spec.ts`. The spec uses a unique description (`` `Coffee ${Date.now()}` ``) rather than the literal "Coffee", so repeat runs never collide. It now covers the full case including the **And** step: it reads the "Spent this month" tile before and after, and asserts the difference is exactly 450 cents — not merely that a new row appeared. (A one-second settle wait is needed first, because the tile animates its count-up over 0.8s.)

---

## BB-2 — Reject zero-amount transaction

**Description:** Verify the app does not allow a transaction to be saved with an amount of $0.00, since a zero-value transaction is meaningless data.

**Pre-condition:** App running, dashboard visible with form.

- **Given** — user is on the "Add Transaction" form
- **When** — enters a valid date and description, sets amount to "$0.00", clicks Save
- **Then** — app rejects the entry with a clear validation error, and no transaction is added

**Post-condition:** no new transaction added to the database.

**Manual result:** PASS (UI + API).
- UI: amount `0` rejected client-side, no transaction added.
- API: `POST` with `amount_cents: 0` returned 400, `fields.amount_cents: "Amount cannot be zero"`. Confirmed via GET that no row was created.

**Automated:** ✅ UI — `e2e/tests/transaction-validation.spec.ts` ("BB-2: rejects a zero-amount transaction"). Asserts the error text appears *and* re-reads the ledger's total count to prove the post-condition — no new transaction added. ✅ API — `server/src/__tests__/transactions.integration.test.ts` ("rejects a zero amount").

---

## BB-4 — Reject or handle negative amount

**Description:** Verify how the app responds when a user manually enters a negative amount, to confirm it either blocks invalid input or handles it in a sensible, intentional way.

**Pre-condition:** App running, dashboard visible with form.

- **Given** — user is on the "Add Transaction" form
- **When** — enters a valid date and description, sets amount to "-$10.00", clicks Save
- **Then** — app either rejects with a validation error, or handles it sensibly — record the actual observed behavior

**Post-condition:** document actual behavior — rejected, or saved (note how stored/displayed if so).

**Manual result:** PASS — exploratory rather than strict pass/fail, since the case explicitly asks to "record actual behavior" rather than expecting one specific outcome.
- UI: typing `-10.00` into the amount textbox fails to parse (`parsePositiveAmountToCents` in `client/src/lib/money.ts` returns `null`), shows "A positive amount, up to 2 decimals". Root cause: that parser only accepts positive numeric strings — no minus sign allowed. Sign is chosen separately via the Expense/Income toggle buttons, not typed.
- API: `POST` with `amount_cents: -2500` (sending the negative value directly, bypassing the UI's toggle mechanism) returned 201 and persisted correctly — this is the correct, intentional internal representation of an expense.
- **Conclusion:** both behaviors are correct and consistent once you understand the UI keeps sign separate from the typed number, while the API's data model uses negative `amount_cents` for expenses.

**Automated:** ✅ UI — `e2e/tests/transaction-validation.spec.ts` ("BB-4: rejects a typed negative amount"). The spec's comment records *why* the error text is identical to BB-2's: a leading `-` fails to parse for the same reason `0.00` does. The API side is deliberately not automated as a rejection case, because a negative `amount_cents` is the correct internal representation of an expense — the valid-payload test in `transactions.integration.test.ts` exercises it as the normal path.

---

## BB-5 — Add a transaction with a future date

**Description:** Verify how the app responds when a transaction is dated far in the future — confirm whether intentionally allowed or blocked.

**Pre-condition:** App running, dashboard visible with form.

- **Given** — user is on the Add Transaction form
- **When** — selects a date one year in the future, valid description and amount, clicks Save
- **Then** — document whether allowed or blocked, and how it appears if allowed

**Post-condition:** document whether saved and how it displays.

**Manual result:** PASS (UI + API) — documented as "blocked".
- UI: date one year in the future rejected by the browser's native date-picker (`max` attribute); no POST request was even sent (confirmed via network log).
- API: `POST` with a date one year in the future (bypassing the UI safeguard entirely) returned 400, `fields.date: "Date cannot be in the future"`. Confirmed via GET that no row was created.
- **Conclusion:** enforced independently at both layers (defense in depth) — not just a UI convenience.

**Automated:** ✅ UI — `e2e/tests/transaction-validation.spec.ts` ("BB-5: blocks a transaction dated a year in the future"). Worth reading: the obvious assertion (look for an error message) would have passed forever without testing anything, because the date input's native `max` attribute blocks submission before any app code runs — so no custom message is ever shown. The spec instead asserts the real mechanism: it watches network traffic to prove **no POST left the browser**, checks the input itself reports `validity.rangeOverflow`, and confirms the ledger count is unchanged. ✅ API — `server/src/__tests__/transactions.integration.test.ts` ("rejects a future-dated transaction").

---

## BB-6 — Reject transaction with empty description

**Description:** Verify the app requires a non-empty description before saving.

**Pre-condition:** App running, dashboard visible with form.

- **Given** — user is on the Add Transaction form
- **When** — leaves description empty, fills valid date and amount, clicks Save
- **Then** — app rejects with a clear validation error; no transaction added

**Post-condition:** no new transaction added to the database.

**Manual result:** PASS (UI + API).
- UI: empty description shows inline error "Give it a name" (client-side, styled message); no transaction added.
- API: `POST` with `description: ""` returned 400, `fields.description: "Description is required"` — a different, plainer message than the UI's, which is expected since it's a fallback layer.
- **Conclusion:** enforced independently at both layers, with two different (both valid) error messages.

**Automated:** ✅ UI — `e2e/tests/transaction-validation.spec.ts` ("BB-6: rejects an empty description"), asserting the "Give it a name" message and an unchanged ledger count. ⚠️ API — not automated. The server's own `description: ""` rejection is still only manually verified; the integration suite covers missing amounts, zero amounts, malformed dates and future dates, but not an empty description.

---

## BB-7 — Add a transaction with an unusually long description

**Description:** Verify the app handles an extremely long description gracefully, without breaking layout or corrupting data.

**Pre-condition:** App running, dashboard visible with form.

- **Given** — user is on the Add Transaction form
- **When** — enters a description over 100 characters, valid date and amount, clicks Save
- **Then** — transaction saves without breaking page layout; description displays sensibly — truncated or wrapped, not cut off mid-word or overflowing

**Post-condition:** transaction saved and viewable without visual breakage.

**Manual result:** FAILED initially → FIXED → PASS (UI + API). This is the one case in the batch with real bug history — top priority for a regression test.
- **Original bug:** description rendered cut off mid-word (e.g. "...transaction d…") using CSS `text-overflow: ellipsis` (Tailwind's `truncate` class), which has no word-boundary awareness.
- **Fix:** `client/src/components/TransactionList.tsx:75-76` — removed `truncate` from the cell and wrapped the description in an inner `<span className="line-clamp-2 break-words">`, which wraps normally at word boundaries across up to 2 lines before clamping, so it can't cut mid-word. *(Verified directly in the current source — confirmed present.)*
- **Retested after fix:** PASS — description wraps cleanly across 2 lines, ends after a complete word, full text still stored intact and reachable via hover tooltip (`title` attribute).
- **API boundary test (new coverage beyond the original case):** a 501-character description correctly rejected with 400, `"String must contain at most 500 character(s)"` — confirms the actual 500-char hard cap (`schemas.ts` `.max(500)`) is enforced; a 480-character description is correctly accepted (201).

**Automated:** ✅ UI — `e2e/tests/transaction-layout.spec.ts` ("BB-7: an unusually long description wraps at word boundaries instead of clipping mid-word"). This is the regression test the case called for: it was the one bug in this batch that actually shipped, and the spec is what stops it silently returning. ⚠️ The 500-character API boundary noted above (501 rejected, 480 accepted) is **not** automated — still manual-only.

---

## BB-8 — Transaction persists after page refresh

**Description:** Verify a saved transaction is persisted to the database, not just held in browser memory.

**Pre-condition:** a valid transaction has just been successfully added.

- **Given** — user has just successfully added a valid transaction
- **When** — user refreshes the browser page
- **Then** — transaction is still present in the list, confirming it was saved to the database rather than only held in memory

**Post-condition:** transaction remains visible after the page reloads.

**Manual result:** PASS (UI + API, triple-verified).
- UI: added a transaction, refreshed the page, transaction still visible.
- API: created via POST (got back an `id`), then fetched it via a completely separate GET request — matched exactly. Independently re-confirmed a third time via curl (a different tool entirely). Three separate requests, two different tools, one consistent row — strong proof of real database persistence, not in-memory state.

**Automated:** ✅ UI — `e2e/tests/transaction-persistence.spec.ts`. The reload is the entire test: the app shows a new row optimistically, before the server confirms anything, so a visible row proves nothing on its own. `page.reload()` discards all client-side state, meaning the row can only reappear if it genuinely reached the database.

---

## BB-A1 to BB-A5 — Authentication

**Written directly as Playwright specs** (`e2e/tests/auth.spec.ts`) when login was introduced, rather than being executed manually first — so unlike BB-1 to BB-8, these have no recorded manual result. They are documented here so this file covers the full automated suite.

### BB-A1 — Sign up, land on an empty dashboard, and log back in with data intact

- **Given** — a visitor with no account, on the login screen
- **When** — they choose "Create an account", sign up with a brand-new email, add a transaction, log out, and log back in
- **Then** — the new account's dashboard is genuinely empty on arrival ("No transactions here!"), and after the logout/login round trip the added transaction is still there

**Post-condition:** a new account exists with exactly one transaction, surviving a full session cycle.

**Why it uses a fresh account:** every other spec logs in as the shared seeded demo account, which is full of pre-existing data. "A brand-new account starts empty" cannot be demonstrated with that account, so this one case creates its own with a timestamped email.

**Automated:** ✅ UI — `e2e/tests/auth.spec.ts`.

### BB-A2 — Signing up with an email that already has an account is rejected

- **Given** — the seeded demo account already exists
- **When** — a visitor tries to sign up with that same email
- **Then** — "An account with that email already exists" is shown, and no second account is created

**Automated:** ✅ UI — `e2e/tests/auth.spec.ts`. Also covered at the API layer by `auth.integration.test.ts` ("rejects a duplicate email with 409").

### BB-A3 — A wrong password is rejected without revealing whether the email exists

- **Given** — an email that does have an account
- **When** — a visitor logs in with the wrong password
- **Then** — the message is the generic "Invalid email or password", identical to the message shown for an email with no account at all

**Why it matters:** if the two messages differed, the login form could be used to discover which email addresses have accounts here — the attack known as *user enumeration*. `auth.integration.test.ts` enforces this at the API layer by asserting the two error bodies are byte-for-byte equal.

**Automated:** ✅ UI — `e2e/tests/auth.spec.ts`. ✅ API — `auth.integration.test.ts`.

### BB-A4 — An unauthenticated visitor sees the login screen, not the dashboard

- **Given** — a visitor with no session
- **When** — they open the app
- **Then** — the login screen is shown, and no part of the dashboard (such as the "Add it!" button) is reachable

**Automated:** ✅ UI — `e2e/tests/auth.spec.ts`. Every protected endpoint is separately proven to return 401 without a session across the server integration suites.

### BB-A5 — A logged-in session survives a page refresh

- **Given** — a logged-in user
- **When** — they refresh the browser
- **Then** — they are still logged in; the session is not lost

**Post-condition:** the session cookie is genuinely persistent, not held only in page memory. This is the auth-layer equivalent of BB-8.

**Automated:** ✅ UI — `e2e/tests/auth.spec.ts`.

---

## Open gaps

Every case in this document now has automated UI coverage. What remains open:

- **BB-3** wasn't in the material you gave me — flagged rather than filled in with a guess.
- **BB-6's API layer isn't automated.** The server rejects an empty description (manually verified, 400 with `fields.description`), but no integration test asserts it. The suite covers missing amounts, zero amounts, malformed dates and future dates — this is the one validation rule tested only through the browser.
- **BB-7's 500-character boundary isn't automated.** The manual pass confirmed 501 characters is rejected and 480 accepted, pinning the `.max(500)` cap in `schemas.ts`. The Playwright spec covers the *layout* half of BB-7 but not the length limit, so that boundary would not be caught if the cap changed.
- **The BB-A\* cases have no manual record.** They were written straight as automated specs. Running them by hand once would let this document report both layers for authentication the way it does for the ledger.
- **Cross-browser results aren't recorded per case.** Every spec runs on Chromium, Firefox, WebKit and a Pixel 5 viewport, so each case is effectively verified four times — but this document doesn't note per-browser outcomes, and a case that failed on only one browser wouldn't be visible here.
