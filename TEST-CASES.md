# BudgetBrain — Manual Test Cases

**Source:** written and manually executed by Nick against the local dev build described in [TEST-PLAN.md](TEST-PLAN.md), verified at both the UI layer (manual browser testing) and the API layer (Postman / curl, hitting the backend directly).
**Purpose:** one record per test case — steps, expected result, and what was actually observed — used both to track manual QA coverage and as the source material for the Playwright suite in `e2e/tests/`.

**Status legend**
- *Manual result* — what happened when this case was actually run by hand, at whichever layer(s) were tested.
- *Automated* — whether a Playwright spec covers this case yet.

## Summary

| ID | Title | Manual result | Automated |
|----|-------|----------------|-----------|
| BB-1 | Add a valid transaction successfully | PASS (UI + API) | ✅ `e2e/tests/manual-transaction-entry.spec.ts` — partial, see Open gaps |
| BB-2 | Reject zero-amount transaction | PASS (UI + API) | Not yet |
| BB-4 | Reject or handle negative amount | PASS — exploratory, both layers behave sensibly | Not yet |
| BB-5 | Add a transaction with a future date | PASS (UI + API) | Not yet |
| BB-6 | Reject transaction with empty description | PASS (UI + API) | Not yet |
| BB-7 | Add a transaction with an unusually long description | FAILED → FIXED → PASS (UI + API) | Not yet — top priority |
| BB-8 | Transaction persists after page refresh | PASS (UI + API, triple-verified) | Not yet |

*BB-3 was not included in what you gave me — left out rather than invented.*

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

**Automated:** Yes — `e2e/tests/manual-transaction-entry.spec.ts`. Note: the spec uses a unique description (`"Coffee at Blue Bottle " + timestamp`) rather than the literal "Coffee", and does not yet assert the "Spent this month" total — see Open gaps below.

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

**Automated:** Not yet.

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

**Automated:** Not yet.

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

**Automated:** Not yet.

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

**Automated:** Not yet.

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

**Automated:** Not yet — a strong candidate to automate soon precisely because it was a real regression once; an automated check is what stops it silently coming back.

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

**Automated:** Not yet.

---

## Open gaps

- **BB-3** wasn't in the material you gave me — flagged rather than filled in with a guess.
- **BB-1's Playwright spec** doesn't yet assert the "Spent this month" total increasing by $4.50 (the "And" line of the case, verified manually as PASS) — only that the row appears with the right date/description/amount.
- **BB-7 has no regression test yet** — it's the one case that actually broke once, so it's the highest-value one to automate next, ideally including the 500-char API boundary in the same pass.
- **BB-2, BB-4, BB-5, BB-6, BB-8 have zero Playwright coverage** — all now have confirmed manual results at both layers, so they're ready to convert without needing any more exploratory testing first.
