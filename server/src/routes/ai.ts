import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { execute } from "../db.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { todayISO } from "../lib/dates.js";
import { recomputeFlags } from "../services/anomaly.js";
import { getRunStatus, startCategorization } from "../services/categorizer.js";
import { callGeminiWithBackoff, GeminiError, parseJsonArrayLoose } from "../services/gemini.js";
import { extractPdfBodySchema, zodFieldErrors } from "../schemas.js";
import { getSettings } from "./settings.js";

export const aiRouter = Router();

aiRouter.post(
  "/categorize",
  asyncHandler(async (req, res) => {
    const result = await startCategorization(req.userId!);
    if ("error" in result) return res.status(409).json(result);
    res.status(202).json(result);
  })
);

aiRouter.get("/categorize/status", (req, res) => {
  res.json(getRunStatus(req.userId!));
});

/**
 * PDF statement extraction. The client has already cropped the statement
 * down to (roughly) the transaction table and redacted identifier-shaped
 * text (see client/src/lib/pdfImport.ts) — this endpoint only ever sees
 * that reduced text, never the raw PDF or the account holder's identity
 * block. Gemini's job is narrow: echo back {date, description, amount}
 * exactly as printed, so the result can flow through the same
 * date/amount-parsing pipeline CSV import already uses (client/src/lib/csv.ts)
 * instead of a second, AI-trusted date parser.
 */
function buildExtractionPrompt(text: string): string {
  return [
    "You extract transaction line-items from bank/credit-card statement text.",
    "For each transaction, reproduce the date and description EXACTLY as printed — do not reformat, translate, or add a year that isn't there.",
    "Resolve the amount into a signed decimal number as a string: NEGATIVE for money leaving the account (purchases, withdrawals, fees, payments), POSITIVE for money arriving (deposits, payroll, refunds, incoming transfers).",
    "Work out the sign from the statement's own layout — separate Withdrawal/Deposit or Debit/Credit columns, or a single column that already carries a sign or a trailing indicator.",
    "Ignore running-balance columns, subtotals, page headers/footers, and any non-transaction text.",
    'Respond with ONLY a JSON array, no markdown fences, no commentary.',
    'Shape: [{"date": "<as printed>", "description": "<as printed>", "amount": "<signed decimal string>"}]',
    "",
    "Examples:",
    'Input line: "Jul 23  STARBUCKS COFFEE  4.50"  (Withdrawal column)  →  {"date":"Jul 23","description":"STARBUCKS COFFEE","amount":"-4.50"}',
    'Input line: "07/25/2026  PAYROLL DEPOSIT  2,000.00"  (Deposit column)  →  {"date":"07/25/2026","description":"PAYROLL DEPOSIT","amount":"2000.00"}',
    "",
    "Statement text:",
    text,
  ].join("\n");
}

interface ExtractedRow {
  date: string;
  description: string;
  amount: string;
}

function parseExtractionResponse(text: string): ExtractedRow[] {
  const arr = parseJsonArrayLoose(text);
  const rows: ExtractedRow[] = [];
  for (const entry of arr) {
    if (typeof entry !== "object" || entry === null) continue;
    const { date, description, amount } = entry as Record<string, unknown>;
    if (typeof date !== "string" || !date.trim()) continue;
    if (typeof description !== "string" || !description.trim()) continue;
    if (typeof amount !== "string" && typeof amount !== "number") continue;
    rows.push({ date: date.trim(), description: description.trim(), amount: String(amount).trim() });
  }
  if (rows.length === 0) throw new Error("No usable transactions in response");
  return rows.slice(0, 1000); // same cap as CSV's MAX_ROWS
}

aiRouter.post(
  "/extract-pdf",
  asyncHandler(async (req, res) => {
    const parsed = extractPdfBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", fields: zodFieldErrors(parsed.error) });
    }
    const prompt = buildExtractionPrompt(parsed.data.text);
    try {
      let rows: ExtractedRow[];
      try {
        rows = parseExtractionResponse(await callGeminiWithBackoff(prompt, "extract-pdf", 1));
      } catch (e) {
        if (e instanceof GeminiError) throw e;
        // One retry on a parse failure, same defensive rule as categorization/suggestions.
        rows = parseExtractionResponse(await callGeminiWithBackoff(prompt, "extract-pdf-retry", 1));
      }
      res.json({ rows });
    } catch (e) {
      const message =
        e instanceof GeminiError
          ? e.kind === "no_key" || e.status === 400 || e.status === 403
            ? "Gemini API key missing or invalid — add it to server/.env and try again."
            : `${e.message}. Try again in a minute.`
          : "The AI couldn't find any transactions in that text — double-check the PDF actually has a transaction table, or try again.";
      res.status(502).json({ error: "extraction_failed", message });
    }
  })
);

aiRouter.post(
  "/flags/recompute",
  asyncHandler(async (req, res) => {
    res.json(await recomputeFlags(req.userId!));
  })
);

aiRouter.patch(
  "/flags/:id/dismiss",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
    const info = await execute(
      "UPDATE transactions SET flagged = 0, flag_dismissed = 1 WHERE id = ? AND user_id = ?",
      [id, req.userId!]
    );
    if (Number(info.rowsAffected) === 0) return res.status(404).json({ error: "Transaction not found" });
    res.json({ ok: true });
  })
);

const suggestionsBody = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

/**
 * Budget suggestions (requirements 5.5). Only aggregates leave the machine:
 * per-category month totals + income. Never the raw transaction list.
 * Responses are cached per (month, data-hash) so repeat clicks are free.
 */
aiRouter.post(
  "/suggestions",
  asyncHandler(async (req, res) => {
    const parsed = suggestionsBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "month must be YYYY-MM" });
    const month = parsed.data.month ?? todayISO().slice(0, 7);

    const { monthly_income_cents } = await getSettings(req.userId!);
    if (monthly_income_cents == null || monthly_income_cents <= 0) {
      return res.status(400).json({
        error: "income_not_set",
        message: "Set your monthly income in Settings first — suggestions are computed against it.",
      });
    }

    const byCategoryResult = await execute(
      `SELECT category, COALESCE(SUM(-amount_cents), 0) AS spent_cents
       FROM transactions
       WHERE substr(date, 1, 7) = ? AND amount_cents < 0
         AND category NOT IN ('Income', 'Transfers') AND user_id = ?
       GROUP BY category ORDER BY spent_cents DESC`,
      [month, req.userId!]
    );
    const byCategory = byCategoryResult.rows as unknown as { category: string; spent_cents: number }[];

    if (byCategory.length === 0) {
      return res.status(400).json({
        error: "no_data",
        message: `No spending recorded for ${month} yet.`,
      });
    }

    const aggregates = { month, monthly_income_cents, by_category: byCategory };
    const dataHash = createHash("sha256").update(JSON.stringify(aggregates)).digest("hex");

    const cachedResult = await execute(
      "SELECT suggestions FROM suggestions_cache WHERE month = ? AND data_hash = ?",
      [month, dataHash]
    );
    const cached = cachedResult.rows[0] as unknown as { suggestions: string } | undefined;
    if (cached) {
      return res.json({ suggestions: JSON.parse(cached.suggestions), cached: true });
    }

    const lines = byCategory
      .map((c) => `${c.category}: $${(c.spent_cents / 100).toFixed(2)}`)
      .join("\n");
    const prompt = [
      "You are a pragmatic personal-finance coach.",
      `Monthly income: $${(monthly_income_cents / 100).toFixed(2)}.`,
      `Spending for ${month} by category:`,
      lines,
      "",
      "Give 3 to 5 specific, actionable suggestions to cut spending, referencing the numbers above.",
      "Respond with ONLY a JSON array of strings, no markdown fences, no commentary.",
      'Example shape: ["Suggestion one.", "Suggestion two.", "Suggestion three."]',
    ].join("\n");

    try {
      let suggestions: string[];
      try {
        suggestions = parseSuggestions(await callGeminiWithBackoff(prompt, "suggestions", byCategory.length));
      } catch (e) {
        if (e instanceof GeminiError) throw e;
        // Parse failure → one retry (same defensive rules as categorization).
        suggestions = parseSuggestions(
          await callGeminiWithBackoff(prompt, "suggestions-retry", byCategory.length)
        );
      }
      await execute(
        "INSERT OR REPLACE INTO suggestions_cache (month, data_hash, suggestions, created_at) VALUES (?, ?, ?, ?)",
        [month, dataHash, JSON.stringify(suggestions), new Date().toISOString()]
      );
      res.json({ suggestions, cached: false });
    } catch (e) {
      const message =
        e instanceof GeminiError
          ? e.kind === "no_key" || e.status === 400 || e.status === 403
            ? "Gemini API key missing or invalid — add it to server/.env and try again."
            : `${e.message}. Try again in a minute.`
          : "Couldn't get usable suggestions from the AI. Try again.";
      res.status(502).json({ error: "suggestions_failed", message });
    }
  })
);

function parseSuggestions(text: string): string[] {
  const arr = parseJsonArrayLoose(text);
  const strings = arr.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
  if (strings.length === 0) throw new Error("No usable suggestions in response");
  return strings.slice(0, 5);
}
