import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { api, ApiError } from "../lib/api";
import { parsePositiveAmountToCents } from "../lib/money";
import type { Settings } from "../lib/types";
import { Card } from "../components/Bits";
import { useToast } from "../components/Toast";

export function SettingsPage({
  settings,
  onSaved,
}: {
  settings: Settings;
  onSaved: (s: Settings) => void;
}) {
  const toast = useToast();
  const [income, setIncome] = useState(
    settings.monthly_income_cents === null ? "" : (settings.monthly_income_cents / 100).toFixed(2)
  );
  const [symbol, setSymbol] = useState(settings.currency_symbol);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    let incomeCents: number | null = null;
    if (income.trim()) {
      incomeCents = parsePositiveAmountToCents(income);
      if (incomeCents === null) {
        toast("error", "Monthly income should be a positive amount (or blank to unset)");
        return;
      }
    }
    if (!symbol.trim()) {
      toast("error", "The currency symbol can't be empty");
      return;
    }
    setSaving(true);
    try {
      const saved = await api.put<Settings>("/api/settings", {
        monthly_income_cents: incomeCents,
        currency_symbol: symbol.trim(),
      });
      onSaved(saved);
      toast("success", "Saved! Everything's tuned to your numbers now ⚙️");
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "Couldn't save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-lg">
      <h2 className="text-lg font-extrabold text-ink-900">⚙️ Your setup</h2>
      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <label className="block text-sm">
          <span className="font-extrabold text-ink-900">Monthly income</span>
          <span className="ml-2 text-xs font-medium text-ink-400">
            powers the "worth a look" flags and the budget coach
          </span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="e.g. 5200.00"
            value={income}
            onChange={(e) => setIncome(e.target.value)}
            className="field mt-1 block w-48"
          />
        </label>
        <label className="block text-sm">
          <span className="font-extrabold text-ink-900">Currency symbol</span>
          <input
            type="text"
            maxLength={3}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="field mt-1 block w-20"
          />
        </label>
        <motion.button whileTap={{ scale: 0.95 }} type="submit" disabled={saving} className="btn-primary">
          {saving ? "Saving…" : "Save settings"}
        </motion.button>
      </form>
    </Card>
  );
}
