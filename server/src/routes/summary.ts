import { Router } from "express";
import { z } from "zod";
import { execute } from "../db.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { trailingMonths, todayISO } from "../lib/dates.js";

export const summaryRouter = Router();

const querySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .default(() => todayISO().slice(0, 7)),
});

/**
 * All aggregates are computed here in SQL (SUM/GROUP BY), never in the
 * frontend. Transfers are excluded from spent/income/net so moving money
 * between accounts doesn't look like spending (assumption noted in README).
 */
summaryRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "month must be YYYY-MM" });
    const { month } = parsed.data;
    const userId = req.userId!;

    const months = trailingMonths(month, 6);

    const [totalsResult, byCategoryResult, spendRowsResult, flaggedResult] = await Promise.all([
      execute(
        `SELECT
           COALESCE(SUM(CASE WHEN amount_cents < 0 AND category != 'Transfers' THEN -amount_cents ELSE 0 END), 0) AS spent_cents,
           COALESCE(SUM(CASE WHEN amount_cents > 0 AND category != 'Transfers' THEN amount_cents ELSE 0 END), 0) AS income_cents
         FROM transactions
         WHERE substr(date, 1, 7) = ? AND user_id = ?`,
        [month, userId]
      ),
      execute(
        `SELECT category, COALESCE(SUM(-amount_cents), 0) AS spent_cents
         FROM transactions
         WHERE substr(date, 1, 7) = ?
           AND amount_cents < 0
           AND category NOT IN ('Income', 'Transfers')
           AND user_id = ?
         GROUP BY category
         ORDER BY spent_cents DESC`,
        [month, userId]
      ),
      execute(
        `SELECT substr(date, 1, 7) AS month, COALESCE(SUM(-amount_cents), 0) AS spent_cents
         FROM transactions
         WHERE substr(date, 1, 7) >= ? AND substr(date, 1, 7) <= ?
           AND amount_cents < 0 AND category != 'Transfers' AND user_id = ?
         GROUP BY substr(date, 1, 7)`,
        [months[0], months[months.length - 1], userId]
      ),
      execute("SELECT COUNT(*) AS flagged_count FROM transactions WHERE flagged = 1 AND user_id = ?", [
        userId,
      ]),
    ]);

    const totals = totalsResult.rows[0] as unknown as { spent_cents: number; income_cents: number };
    const byCategory = byCategoryResult.rows as unknown as { category: string; spent_cents: number }[];
    const spendRows = spendRowsResult.rows as unknown as { month: string; spent_cents: number }[];
    const { flagged_count } = flaggedResult.rows[0] as unknown as { flagged_count: number };

    const spendByMonth = new Map(spendRows.map((r) => [r.month, r.spent_cents]));
    const six_month_series = months.map((m) => ({
      month: m,
      spent_cents: spendByMonth.get(m) ?? 0,
    }));

    res.json({
      month,
      spent_cents: totals.spent_cents,
      income_cents: totals.income_cents,
      net_cents: totals.income_cents - totals.spent_cents,
      flagged_count,
      by_category: byCategory,
      six_month_series,
    });
  })
);
