import { Router } from "express";
import { db } from "../db.js";
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

transactionsRouter.get("/", (req, res) => {
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

  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM transactions ${whereSql}`)
    .get(params) as { total: number };
  const rows = db
    .prepare(
      `SELECT * FROM transactions ${whereSql}
       ORDER BY date DESC, id DESC
       LIMIT ${PAGE_SIZE} OFFSET @offset`
    )
    .all({ ...params, offset: (page - 1) * PAGE_SIZE });

  res.json({
    rows,
    total,
    page,
    page_size: PAGE_SIZE,
    page_count: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
});

const insertStmt = () =>
  db.prepare(
    `INSERT INTO transactions (date, description, amount_cents, category, category_source, created_at, user_id)
     VALUES (@date, @description, @amount_cents, @category, @category_source, @created_at, @user_id)`
  );

transactionsRouter.post("/", (req, res) => {
  const parsed = transactionCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", fields: zodFieldErrors(parsed.error) });
  }
  const t = parsed.data;
  const info = insertStmt().run({
    date: t.date,
    description: t.description,
    amount_cents: t.amount_cents,
    category: t.category,
    category_source: "manual",
    created_at: nowISO(),
    user_id: req.userId,
  });
  const row = db
    .prepare("SELECT * FROM transactions WHERE id = ? AND user_id = ?")
    .get(info.lastInsertRowid, req.userId);
  res.status(201).json(row);
});

/**
 * Bulk import from the CSV mapping step. Rows are validated individually:
 * invalid rows are skipped (with reasons), never fatal. Duplicates — same
 * (date, amount_cents, normalized description) as an existing transaction —
 * are imported anyway but reported as warnings, per requirements 4.2.6.
 */
transactionsRouter.post("/import", (req, res) => {
  const body = importBodySchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: "Invalid import payload", fields: zodFieldErrors(body.error) });
  }

  const dupStmt = db.prepare(
    "SELECT id, description FROM transactions WHERE date = ? AND amount_cents = ? AND user_id = ?"
  );
  const insert = insertStmt();

  const skipped: { row: number; reason: string }[] = [];
  const duplicates: { row: number; description: string }[] = [];
  let imported = 0;

  db.transaction(() => {
    body.data.rows.forEach((raw, idx) => {
      const parsed = importRowSchema.safeParse(raw);
      if (!parsed.success) {
        const fields = zodFieldErrors(parsed.error);
        skipped.push({
          row: idx + 1,
          reason: Object.entries(fields)
            .map(([f, m]) => `${f}: ${m}`)
            .join("; "),
        });
        return;
      }
      const t = parsed.data;
      const key = merchantKey(t.description);
      const candidates = dupStmt.all(t.date, t.amount_cents, req.userId) as {
        id: number;
        description: string;
      }[];
      if (candidates.some((c) => merchantKey(c.description) === key)) {
        duplicates.push({ row: idx + 1, description: t.description });
      }
      insert.run({
        date: t.date,
        description: t.description,
        amount_cents: t.amount_cents,
        category: t.category,
        category_source: "manual",
        created_at: nowISO(),
        user_id: req.userId,
      });
      imported++;
    });
  })();

  res.json({ imported, skipped, duplicates });
});

transactionsRouter.patch("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
  const existing = db
    .prepare("SELECT * FROM transactions WHERE id = ? AND user_id = ?")
    .get(id, req.userId) as { description: string; category: string } | undefined;
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
  if (patch.category !== undefined && patch.category !== existing.category) {
    sets.push("category_source = 'manual'");
    const key = merchantKey(patch.description ?? existing.description);
    if (key) {
      db.prepare(
        `INSERT INTO merchant_category_cache (merchant_key, category, hit_count)
         VALUES (?, ?, 1)
         ON CONFLICT(merchant_key) DO UPDATE SET category = excluded.category, hit_count = hit_count + 1`
      ).run(key, patch.category);
    }
  }

  db.prepare(`UPDATE transactions SET ${sets.join(", ")} WHERE id = @id AND user_id = @userId`).run(
    params
  );
  res.json(db.prepare("SELECT * FROM transactions WHERE id = ? AND user_id = ?").get(id, req.userId));
});

transactionsRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
  const info = db
    .prepare("DELETE FROM transactions WHERE id = ? AND user_id = ?")
    .run(id, req.userId);
  if (info.changes === 0) return res.status(404).json({ error: "Transaction not found" });
  res.status(204).end();
});
