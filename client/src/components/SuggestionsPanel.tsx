import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { api, ApiError } from "../lib/api";
import { Card, Spinner } from "./Bits";
import { useToast } from "./Toast";

/**
 * "Coach me" — the backend sends only aggregates to Gemini and caches per
 * (month, data-hash), so repeat clicks don't burn quota. Suggestions reveal
 * one by one.
 */
export function SuggestionsPanel({ month, onNeedsIncome }: { month: string; onNeedsIncome: () => void }) {
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [cached, setCached] = useState(false);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  async function fetchSuggestions() {
    setLoading(true);
    try {
      const res = await api.post<{ suggestions: string[]; cached: boolean }>("/api/suggestions", { month });
      setSuggestions(res.suggestions);
      setCached(res.cached);
    } catch (e) {
      if (e instanceof ApiError && e.code === "income_not_set") {
        toast("info", "Tell us your monthly income first — then the coach knows what to aim for!");
        onNeedsIncome();
      } else {
        toast("error", e instanceof ApiError ? e.message : "The coach is napping — try again in a minute.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-spark-100 bg-gradient-to-br from-white to-spark-100/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-ink-900">
          🧞 Budget coach
        </h3>
        <motion.button whileTap={{ scale: 0.95 }} type="button" onClick={fetchSuggestions} disabled={loading} className="btn-spark">
          {suggestions ? "Coach me again" : "Coach me"}
        </motion.button>
      </div>
      {loading && (
        <div className="mt-3">
          <Spinner label="Thinking it over (only your monthly totals leave the house)…" />
        </div>
      )}
      <AnimatePresence>
        {!loading && suggestions && (
          <motion.ul initial="hidden" animate="show" className="mt-3 space-y-2 text-sm">
            {suggestions.map((s, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.12 }}
                className="flex items-start gap-2 rounded-2xl bg-white/80 px-3 py-2 font-semibold text-ink-600 shadow-soft"
              >
                <span aria-hidden>💡</span>
                {s}
              </motion.li>
            ))}
            {cached && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: suggestions.length * 0.12 }}
                className="text-xs font-bold text-ink-400"
              >
                ⚡ Served from cache — didn't cost a single API call.
              </motion.p>
            )}
          </motion.ul>
        )}
      </AnimatePresence>
      {!loading && !suggestions && (
        <p className="mt-2 text-sm font-medium text-ink-600">
          The coach looks at this month's totals against your income and hands you 3–5 concrete ways to save.
        </p>
      )}
    </Card>
  );
}
