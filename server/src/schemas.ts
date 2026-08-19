import { z } from "zod";
import { CATEGORIES } from "./lib/categories.js";
import { isValidISODate, todayISO } from "./lib/dates.js";

export const isoDate = z
  .string()
  .refine(isValidISODate, { message: "Date must be a valid YYYY-MM-DD date" });

const isoDateNotFuture = isoDate.refine((d) => d <= todayISO(), {
  message: "Date cannot be in the future",
});

export const categoryEnum = z.enum(CATEGORIES);

// All money fields are integer cents — enforced here so a float in a payload
// is a 400, never a silent rounding.
const cents = z.number().int({ message: "Money must be integer cents" });

export const transactionCreateSchema = z.object({
  date: isoDateNotFuture,
  description: z.string().trim().min(1, "Description is required").max(500),
  amount_cents: cents.refine((v) => v !== 0, { message: "Amount cannot be zero" }),
  category: categoryEnum.optional().default("Uncategorized"),
});

export const transactionPatchSchema = z
  .object({
    date: isoDateNotFuture,
    description: z.string().trim().min(1).max(500),
    amount_cents: cents.refine((v) => v !== 0, { message: "Amount cannot be zero" }),
    category: categoryEnum,
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: "No fields to update" });

// Import rows are validated one at a time so a bad row is skipped, not fatal.
export const importRowSchema = transactionCreateSchema;

export const importBodySchema = z.object({
  rows: z.array(z.unknown()).max(1000, "Imports are capped at 1,000 rows"),
});

export const settingsPutSchema = z
  .object({
    monthly_income_cents: cents.min(0).nullable(),
    currency_symbol: z.string().trim().min(1).max(3),
  })
  .partial();

export const goalCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  target_cents: cents.min(1, "Target must be positive"),
  deadline: isoDate,
});

export const goalPatchSchema = goalCreateSchema
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: "No fields to update" });

export const listQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  category: categoryEnum.optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  flagged: z.enum(["1"]).optional(),
});

export function zodFieldErrors(error: z.ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}
