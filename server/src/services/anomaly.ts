import { db } from "../db.js";
import { addDaysISO } from "../lib/dates.js";
import { getSettings } from "../routes/settings.js";

interface ExpenseRow {
  id: number;
  date: string;
  category: string;
  amount_cents: number;
  flag_dismissed: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Local anomaly detection (no API calls), requirements 5.4:
 *  - expense > 3× the median expense in its category over the trailing 90
 *    days, requiring ≥5 prior transactions in that category in the window;
 *  - any single expense > 30% of monthly income (when income is set).
 * Dismissed flags stay dismissed across recomputes (flag_dismissed column —
 * assumption noted in README).
 */
export function recomputeFlags(): { flagged_count: number } {
  const { monthly_income_cents } = getSettings();
  const expenses = db
    .prepare(
      `SELECT id, date, category, amount_cents, flag_dismissed
       FROM transactions
       WHERE amount_cents < 0 AND category NOT IN ('Income', 'Transfers')
       ORDER BY date ASC, id ASC`
    )
    .all() as ExpenseRow[];

  const byCategory = new Map<string, ExpenseRow[]>();
  for (const e of expenses) {
    let list = byCategory.get(e.category);
    if (!list) byCategory.set(e.category, (list = []));
    list.push(e);
  }

  const updates: { id: number; flagged: number; reason: string | null }[] = [];

  for (const e of expenses) {
    const abs = -e.amount_cents;
    const reasons: string[] = [];

    const peers = byCategory.get(e.category)!;
    const windowStart = addDaysISO(e.date, -90);
    const prior = peers.filter(
      (p) =>
        (p.date < e.date || (p.date === e.date && p.id < e.id)) &&
        p.date >= windowStart
    );
    // The median rule only makes sense within a real category — comparing
    // against the "Uncategorized" grab-bag would flag noise.
    if (e.category !== "Uncategorized" && prior.length >= 5) {
      const med = median(prior.map((p) => -p.amount_cents));
      if (med > 0 && abs > 3 * med) {
        reasons.push(
          `${fmt(abs)} is more than 3× the 90-day median for ${e.category} (${fmt(med)})`
        );
      }
    }

    if (monthly_income_cents != null && monthly_income_cents > 0) {
      const threshold = Math.round(monthly_income_cents * 0.3);
      if (abs > threshold) {
        reasons.push(
          `${fmt(abs)} exceeds 30% of your monthly income (${fmt(monthly_income_cents)})`
        );
      }
    }

    const shouldFlag = reasons.length > 0 && !e.flag_dismissed;
    updates.push({
      id: e.id,
      flagged: shouldFlag ? 1 : 0,
      reason: shouldFlag ? reasons.join(". ") : null,
    });
  }

  const stmt = db.prepare("UPDATE transactions SET flagged = ?, flag_reason = ? WHERE id = ?");
  let flagged = 0;
  db.transaction(() => {
    for (const u of updates) {
      stmt.run(u.flagged, u.reason, u.id);
      if (u.flagged) flagged++;
    }
  })();

  return { flagged_count: flagged };
}
