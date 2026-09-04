import { execute, withTransaction } from "../db.js";
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

export interface AnomalyCheckInput {
  category: string;
  amountCentsAbs: number;
  priorCategoryAmountsCentsAbs: number[];
  monthlyIncomeCents: number | null;
}

/**
 * Pure boundary-rule evaluation (requirements 5.4), extracted out of
 * recomputeFlags so it can be unit-tested without a database:
 *  - expense > 3x the median of `priorCategoryAmountsCentsAbs`, only when
 *    there are >=5 prior amounts and the category isn't "Uncategorized";
 *  - expense > 30% of monthlyIncomeCents, when income is set and > 0.
 * Returns one human-readable reason per rule that fired (empty = not flagged).
 * Behavior is unchanged from before this refactor — recomputeFlags below
 * now just calls this instead of doing the same math inline.
 */
export function evaluateAnomaly(input: AnomalyCheckInput): string[] {
  const { category, amountCentsAbs, priorCategoryAmountsCentsAbs, monthlyIncomeCents } = input;
  const reasons: string[] = [];

  if (category !== "Uncategorized" && priorCategoryAmountsCentsAbs.length >= 5) {
    const med = median(priorCategoryAmountsCentsAbs);
    if (med > 0 && amountCentsAbs > 3 * med) {
      reasons.push(
        `${fmt(amountCentsAbs)} is more than 3× the 90-day median for ${category} (${fmt(med)})`
      );
    }
  }

  if (monthlyIncomeCents != null && monthlyIncomeCents > 0) {
    const threshold = Math.round(monthlyIncomeCents * 0.3);
    if (amountCentsAbs > threshold) {
      reasons.push(
        `${fmt(amountCentsAbs)} exceeds 30% of your monthly income (${fmt(monthlyIncomeCents)})`
      );
    }
  }

  return reasons;
}

/**
 * Local anomaly detection (no API calls), requirements 5.4:
 *  - expense > 3× the median expense in its category over the trailing 90
 *    days, requiring ≥5 prior transactions in that category in the window;
 *  - any single expense > 30% of monthly income (when income is set).
 * Dismissed flags stay dismissed across recomputes (flag_dismissed column —
 * assumption noted in README).
 */
export async function recomputeFlags(userId: number): Promise<{ flagged_count: number }> {
  const { monthly_income_cents } = await getSettings(userId);
  const result = await execute(
    `SELECT id, date, category, amount_cents, flag_dismissed
     FROM transactions
     WHERE amount_cents < 0 AND category NOT IN ('Income', 'Transfers') AND user_id = ?
     ORDER BY date ASC, id ASC`,
    [userId]
  );
  const expenses = result.rows as unknown as ExpenseRow[];

  const byCategory = new Map<string, ExpenseRow[]>();
  for (const e of expenses) {
    let list = byCategory.get(e.category);
    if (!list) byCategory.set(e.category, (list = []));
    list.push(e);
  }

  const updates: { id: number; flagged: number; reason: string | null }[] = [];

  for (const e of expenses) {
    const abs = -e.amount_cents;
    const peers = byCategory.get(e.category)!;
    const windowStart = addDaysISO(e.date, -90);
    const prior = peers.filter(
      (p) => (p.date < e.date || (p.date === e.date && p.id < e.id)) && p.date >= windowStart
    );

    const reasons = evaluateAnomaly({
      category: e.category,
      amountCentsAbs: abs,
      priorCategoryAmountsCentsAbs: prior.map((p) => -p.amount_cents),
      monthlyIncomeCents: monthly_income_cents,
    });

    const shouldFlag = reasons.length > 0 && !e.flag_dismissed;
    updates.push({
      id: e.id,
      flagged: shouldFlag ? 1 : 0,
      reason: shouldFlag ? reasons.join(". ") : null,
    });
  }

  let flagged = 0;
  await withTransaction(async (tx) => {
    for (const u of updates) {
      await tx.execute({
        sql: "UPDATE transactions SET flagged = ?, flag_reason = ? WHERE id = ? AND user_id = ?",
        args: [u.flagged, u.reason, u.id, userId],
      });
      if (u.flagged) flagged++;
    }
  });

  return { flagged_count: flagged };
}
