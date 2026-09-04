import { Router } from "express";
import type { InArgs } from "@libsql/client";
import { execute, withTransaction } from "../db.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { merchantKey } from "../lib/normalize.js";
import { nowISO } from "../lib/dates.js";
import {
  importBodySchema,
  importRowSchema,
  listQuerySchema,
  transactionCreateSchema,
  transactionPatchSchema,
  zodFieldErrors,
} from "../schemas.js";

export const transactionsRouter = Router();

const PAGE_SIZE = 50;

transactionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid query", fields: zodFieldErrors(parsed.error) });
    }
    const { month, category, search, page, flagged } = parsed.data;

    const where: string[] = ["user_id = @userId"];
    const params: Record<string, unknown> = { userId: req.userId };
    if (month) {
      where.push("substr(date, 1, 7) = @month");
      params.month = month;
    }
    if (category) {
      where.push("category = @category");
      params.category = category;
    }
    if (search) {
      where.push("description LIKE @search");
      params.search = `%${search}%`;
    }
    if (flagged) {
      where.push("flagged = 1");
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;

    const totalResult = await execute(
      `SELECT COUNT(*) AS total FROM transactions ${whereSql}`,
      params as unknown as InArgs
    );
    const { total } = totalResult.rows[0] as unknown as { total: number };
    const rowsResult = await execute(
      `SELECT * FROM transactions ${whereSql}
       ORDER BY date DESC, id DESC
       LIMIT ${PAGE_SIZE} OFFSET @offset`,
      { ...params, offset: (page - 1) * PAGE_SIZE } as unknown as InArgs
    );

    res.json({
      rows: rowsResult.rows,
      total,
      page,
      page_size: PAGE_SIZE,
      page_count: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    });
  })
);

const INSERT_SQL = `INSERT INTO transactions (date, description, amount_cents, category, category_source, created_at, user_id)
     VALUES (@date, @description, @amount_cents, @category, @category_source, @created_at, @user_id)`;

transactionsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = transactionCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", fields: zodFieldErrors(parsed.error) });
    }
    const t = parsed.data;
    const info = await execute(INSERT_SQL, {
      date: t.date,
      description: t.description,
      amount_cents: t.amount_cents,
      category: t.category,
      category_source: "manual",
      created_at: nowISO(),
      user_id: req.userId!,
    });
    const rowResult = await execute("SELECT * FROM transactions WHERE id = ? AND user_id = ?", [
      Number(info.lastInsertRowid),
      req.userId!,
    ]);
    res.status(201).json(rowResult.rows[0]);
  })
);

/**
 * Bulk import from the CSV mapping step. Rows are validated individually:
 * invalid rows are skipped (with reasons), never fatal. Duplicates — same
 * (date, amount_cents, normalized description) as an existing transaction —
 * are imported anyway but reported as warnings, per requirements 4.2.6.
 */
transactionsRouter.post(
  "/import",
  asyncHandler(async (req, res) => {
    const body = importBodySchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: "Invalid import payload", fields: zodFieldErrors(body.error) });
    }

    const skipped: { row: number; reason: string }[] = [];
    const duplicates: { row: number; description: string }[] = [];
    let imported = 0;

    await withTransaction(async (tx) => {
      for (let idx = 0; idx < body.data.rows.length; idx++) {
        const raw = body.data.rows[idx];
        const parsed = importRowSchema.safeParse(raw);
        if (!parsed.success) {
          const fields = zodFieldErrors(parsed.error);
          skipped.push({
            row: idx + 1,
            reason: Object.entries(fields)
              .map(([f, m]) => `${f}: ${m}`)
              .join("; "),
          });
          continue;
        }
        const t = parsed.data;
        const key = merchantKey(t.description);
        const candidatesResult = await tx.execute({
          sql: "SELECT id, description FROM transactions WHERE date = ? AND amount_cents = ? AND user_id = ?",
          args: [t.date, t.amount_cents, req.userId!],
        });
        const candidates = candidatesResult.rows as unknown as { id: number; description: string }[];
        if (candidates.some((c) => merchantKey(c.description) === key)) {
          duplicates.push({ row: idx + 1, description: t.description });
        }
        await tx.execute({
          sql: INSERT_SQL,
          args: {
            date: t.date,
            description: t.description,
            amount_cents: t.amount_cents,
            category: t.category,
            category_source: "manual",
            created_at: nowISO(),
            user_id: req.userId!,
          },
        });
        imported++;
      }
    });

    res.json({ imported, skipped, duplicates });
  })
);

transactionsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
    const existingResult = await execute("SELECT * FROM transactions WHERE id = ? AND user_id = ?", [
      id,
      req.userId!,
    ]);
    const existing = existingResult.rows[0] as unknown as
      | { description: string; category: string }
      | undefined;
    if (!existing) return res.status(404).json({ error: "Transaction not found" });

    const parsed = transactionPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", fields: zodFieldErrors(parsed.error) });
    }
    const patch = parsed.data;

    const sets: string[] = [];
    const params: Record<string, unknown> = { id, userId: req.userId };
    for (const field of ["date", "description", "amount_cents", "category"] as const) {
      if (patch[field] !== undefined) {
        sets.push(`${field} = @${field}`);
        params[field] = patch[field];
      }
    }
    // A user-made category change is authoritative: record provenance and teach
    // the merchant cache so future imports of this merchant skip the API.
    // The category update and the merchant-cache write commit together, so a
    // teach-the-cache write never lands without its matching category change.
    const teachCache = patch.category !== undefined && patch.category !== existing.category;
    if (teachCache) sets.push("category_source = 'manual'");

    await withTransaction(async (tx) => {
      await tx.execute({
        sql: `UPDATE transactions SET ${sets.join(", ")} WHERE id = @id AND user_id = @userId`,
        args: params as unknown as InArgs,
      });
      if (teachCache) {
        const key = merchantKey(patch.description ?? existing.description);
        if (key) {
          await tx.execute({
            sql: `INSERT INTO merchant_category_cache (merchant_key, category, hit_count)
                  VALUES (?, ?, 1)
                  ON CONFLICT(merchant_key) DO UPDATE SET category = excluded.category, hit_count = hit_count + 1`,
            args: [key, patch.category!],
          });
        }
      }
    });

    const rowResult = await execute("SELECT * FROM transactions WHERE id = ? AND user_id = ?", [
      id,
      req.userId!,
    ]);
    res.json(rowResult.rows[0]);
  })
);

transactionsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
    const info = await execute("DELETE FROM transactions WHERE id = ? AND user_id = ?", [id, req.userId!]);
    if (Number(info.rowsAffected) === 0) return res.status(404).json({ error: "Transaction not found" });
    res.status(204).end();
  })
);
