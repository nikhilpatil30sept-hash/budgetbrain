import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { todayISO } from "../lib/dates.js";
import { recomputeFlags } from "../services/anomaly.js";
import { getRunStatus, startCategorization } from "../services/categorizer.js";
import { callGeminiWithBackoff, GeminiError, parseJsonArrayLoose } from "../services/gemini.js";
import { getSettings } from "./settings.js";

export const aiRouter = Router();

aiRouter.post("/categorize", (_req, res) => {
  const result = startCategorization();
  if ("error" in result) return res.status(409).json(result);
  res.status(202).json(result);
});

aiRouter.get("/categorize/status", (_req, res) => {
  res.json(getRunStatus());
});

aiRouter.post("/flags/recompute", (_req, res) => {
  res.json(recomputeFlags());
});

aiRouter.patch("/flags/:id/dismiss", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
  const info = db
    .prepare("UPDATE transactions SET flagged = 0, flag_dismissed = 1 WHERE id = ?")
    .run(id);
  if (info.changes === 0) return res.status(404).json({ error: "Transaction not found" });
  res.json({ ok: true });
});

const suggestionsBody = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

/**
 * Budget suggestions (requirements 5.5). Only aggregates leave the machine:
 * per-category month totals + income. Never the raw transaction list.
 * Responses are cached per (month, data-hash) so repeat clicks are free.
 */
aiRouter.post("/suggestions", async (req, res) => {
  const parsed = suggestionsBody.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "month must be YYYY-MM" });
  const month = parsed.data.month ?? todayISO().slice(0, 7);

  const { monthly_income_cents } = getSettings();
  if (monthly_income_cents == null || monthly_income_cents <= 0) {
    return res.status(400).json({
      error: "income_not_set",
      message: "Set your monthly income in Settings first — suggestions are computed against it.",
    });
  }

  const byCategory = db
    .prepare(
      `SELECT category, COALESCE(SUM(-amount_cents), 0) AS spent_cents
       FROM transactions
       WHERE substr(date, 1, 7) = ? AND amount_cents < 0
         AND category NOT IN ('Income', 'Transfers')
       GROUP BY category ORDER BY spent_cents DESC`
    )
    .all(month) as { category: string; spent_cents: number }[];

  if (byCategory.length === 0) {
    return res.status(400).json({
      error: "no_data",
      message: `No spending recorded for ${month} yet.`,
    });
  }

  const aggregates = { month, monthly_income_cents, by_category: byCategory };
  const dataHash = createHash("sha256").update(JSON.stringify(aggregates)).digest("hex");

  const cached = db
    .prepare("SELECT suggestions FROM suggestions_cache WHERE month = ? AND data_hash = ?")
    .get(month, dataHash) as { suggestions: string } | undefined;
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
    db.prepare(
      "INSERT OR REPLACE INTO suggestions_cache (month, data_hash, suggestions, created_at) VALUES (?, ?, ?, ?)"
    ).run(month, dataHash, JSON.stringify(suggestions), new Date().toISOString());
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
});

function parseSuggestions(text: string): string[] {
  const arr = parseJsonArrayLoose(text);
  const strings = arr.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
  if (strings.length === 0) throw new Error("No usable suggestions in response");
  return strings.slice(0, 5);
}
