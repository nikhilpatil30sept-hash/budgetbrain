import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { api, ApiError } from "../lib/api";
import { formatCents } from "../lib/money";
import type { Transaction } from "../lib/types";
import { useToast } from "./Toast";

/**
 * Anomaly section — warm honey "heads up", not alarm red. Dismissed rows
 * slide away instead of vanishing.
 */
export function FlaggedSection({
  flagged,
  symbol,
  onChanged,
}: {
  flagged: Transaction[];
  symbol: string;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busyId, setBusyId] = useState<number | null>(null);

  if (flagged.length === 0) return null;

  async function dismiss(id: number) {
    setBusyId(id);
    try {
      await api.patch(`/api/flags/${id}/dismiss`);
      toast("info", "Got it — we won't mention that one again.");
      onChanged();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Couldn't dismiss that flag");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-blob border border-honey-200/70 bg-honey-50/60 p-4 shadow-soft backdrop-blur-xl"
    >
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-honey-700">
        <span className="animate-wiggle" aria-hidden>
          👀
        </span>
        Heads up — these stood out
      </h3>
      <ul className="space-y-2">
        <AnimatePresence>
          {flagged.map((tx) => (
            <motion.li
              key={tx.id}
              layout
              exit={{ opacity: 0, x: 40, height: 0 }}
              className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/70 px-3 py-2 text-sm"
            >
              <span className="font-semibold tabular-nums text-ink-400">{tx.date}</span>
              <span className="font-extrabold text-ink-900">{tx.description}</span>
              <span className="font-extrabold tabular-nums text-honey-700">{formatCents(tx.amount_cents, symbol)}</span>
              <span className="flex-1 font-medium text-ink-600">{tx.flag_reason}</span>
              <motion.button
                whileTap={{ scale: 0.92 }}
                type="button"
                disabled={busyId === tx.id}
                onClick={() => dismiss(tx.id)}
                className="rounded-full border-2 border-honey-200 bg-white px-3 py-1 text-xs font-extrabold text-honey-700 transition-colors hover:bg-honey-50 disabled:opacity-50"
              >
                All good 👍
              </motion.button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </motion.div>
  );
}
