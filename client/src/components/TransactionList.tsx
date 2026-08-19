import { useState } from "react";
import { motion } from "framer-motion";
import { CATEGORIES, categoryIcon } from "../lib/categories";
import { formatCents } from "../lib/money";
import type { Transaction, TransactionPage } from "../lib/types";
import { CategoryBadge, EmptyState, Skeleton } from "./Bits";

/**
 * Paginated ledger (50/page, newest first). Rows cascade in; category
 * badges spring in one by one (keyed on the category, so an AI run makes
 * fresh labels visibly land). Inline category editing teaches the merchant
 * cache, exactly as before.
 */
export function TransactionList({
  page,
  loading,
  symbol,
  onPageChange,
  onCategoryChange,
  onDelete,
}: {
  page: TransactionPage | null;
  loading: boolean;
  symbol: string;
  onPageChange: (p: number) => void;
  onCategoryChange: (tx: Transaction, category: string) => void;
  onDelete: (tx: Transaction) => void;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);

  if (loading && !page) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (!page || page.rows.length === 0) {
    return (
      <EmptyState
        icon="🧾"
        title="No transactions here!"
        hint="Jot one down above, import a CSV, or loosen those filters a little."
      />
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-cream-200 text-left text-xs font-extrabold uppercase tracking-wide text-ink-400">
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">What</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {page.rows.map((tx, i) => (
              <motion.tr
                key={tx.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.025, 0.5), duration: 0.25 }}
                className={`group border-b border-cream-100 transition-colors hover:bg-cream-50 ${
                  tx.flagged === 1 ? "bg-honey-50" : ""
                }`}
              >
                <td className="whitespace-nowrap px-3 py-2.5 font-semibold tabular-nums text-ink-400">{tx.date}</td>
                <td className="max-w-64 px-3 py-2.5 font-bold text-ink-900" title={tx.description}>
                  <span className="line-clamp-2 break-words">
                    {tx.flagged === 1 && (
                      <span title={tx.flag_reason ?? "Worth a look"} className="mr-1" aria-label="Worth a look">
                        👀
                      </span>
                    )}
                    {tx.description}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  {editingId === tx.id ? (
                    <select
                      autoFocus
                      defaultValue={tx.category}
                      onBlur={() => setEditingId(null)}
                      onChange={(e) => {
                        onCategoryChange(tx, e.target.value);
                        setEditingId(null);
                      }}
                      className="rounded-xl border-2 border-cream-200 px-1.5 py-1 text-xs font-bold focus:border-brand-300 focus:outline-none"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {categoryIcon(c)} {c}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.06 }}
                      whileTap={{ scale: 0.94 }}
                      onClick={() => setEditingId(tx.id)}
                      title={`Labeled by: ${tx.category_source} — click to change`}
                    >
                      <CategoryBadge key={tx.category} category={tx.category} pop delay={Math.min(i * 0.05, 0.8)} />
                    </motion.button>
                  )}
                </td>
                <td
                  className={`whitespace-nowrap px-3 py-2.5 text-right font-extrabold tabular-nums ${
                    tx.amount_cents < 0 ? "text-ink-900" : "text-grow-600"
                  }`}
                >
                  {tx.amount_cents > 0 && "+"}
                  {formatCents(tx.amount_cents, symbol)}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => onDelete(tx)}
                    className="invisible rounded-full px-1.5 text-xs font-bold text-ink-400 transition-colors hover:text-brand-600 group-hover:visible"
                    aria-label={`Delete ${tx.description}`}
                  >
                    ✕
                  </button>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-3 py-2.5 text-sm font-bold text-ink-600">
        <span>
          {page.total} transaction{page.total === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page.page <= 1}
            onClick={() => onPageChange(page.page - 1)}
            className="rounded-xl border-2 border-cream-200 px-2.5 py-1 transition-all hover:border-brand-200 hover:text-brand-600 active:scale-95 disabled:opacity-40"
          >
            ‹ Prev
          </button>
          <span className="tabular-nums">
            {page.page} / {page.page_count}
          </span>
          <button
            type="button"
            disabled={page.page >= page.page_count}
            onClick={() => onPageChange(page.page + 1)}
            className="rounded-xl border-2 border-cream-200 px-2.5 py-1 transition-all hover:border-brand-200 hover:text-brand-600 active:scale-95 disabled:opacity-40"
          >
            Next ›
          </button>
        </div>
      </div>
    </div>
  );
}
