import { Router } from "express";
import { db } from "../db.js";
import { settingsPutSchema, zodFieldErrors } from "../schemas.js";

export const settingsRouter = Router();

const DEFAULTS = { monthly_income_cents: null as number | null, currency_symbol: "$" };

export function getSettings(userId: number): { monthly_income_cents: number | null; currency_symbol: string } {
  const rows = db.prepare("SELECT key, value FROM settings WHERE user_id = ?").all(userId) as {
    key: string;
    value: string | null;
  }[];
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const income = map.get("monthly_income_cents");
  return {
    monthly_income_cents: income == null ? DEFAULTS.monthly_income_cents : Number(income),
    currency_symbol: map.get("currency_symbol") ?? DEFAULTS.currency_symbol,
  };
}

settingsRouter.get("/", (req, res) => {
  res.json(getSettings(req.userId!));
});

settingsRouter.put("/", (req, res) => {
  const parsed = settingsPutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", fields: zodFieldErrors(parsed.error) });
  }
  const upsert = db.prepare(
    "INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value"
  );
  const { monthly_income_cents, currency_symbol } = parsed.data;
  if (monthly_income_cents !== undefined) {
    upsert.run(req.userId, "monthly_income_cents", monthly_income_cents === null ? null : String(monthly_income_cents));
  }
  if (currency_symbol !== undefined) {
    upsert.run(req.userId, "currency_symbol", currency_symbol);
  }
  res.json(getSettings(req.userId!));
});
