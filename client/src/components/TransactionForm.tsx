import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { CATEGORIES, categoryIcon } from "../lib/categories";
import { parsePositiveAmountToCents } from "../lib/money";
import { Card } from "./Bits";

export interface NewTransaction {
  date: string;
  description: string;
  amount_cents: number;
  category: string;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * Manual entry (requirements 4.1). Amount is typed as a positive decimal;
 * the expense/income toggle decides the sign at submit time.
 */
export function TransactionForm({ onSubmit }: { onSubmit: (t: NewTransaction) => void }) {
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<"expense" | "income">("expense");
  const [category, setCategory] = useState("Uncategorized");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!date) errs.date = "When did this happen?";
    else if (date > todayISO()) errs.date = "No fortune-telling — today or earlier!";
    if (!description.trim()) errs.description = "Give it a name";
    const cents = parsePositiveAmountToCents(amount);
    if (cents === null) errs.amount = "A positive amount, up to 2 decimals";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    onSubmit({
      date,
      description: description.trim(),
      amount_cents: type === "expense" ? -cents! : cents!,
      category,
    });
    setDescription("");
    setAmount("");
    setCategory("Uncategorized");
  }

  return (
    <Card>
      <h3 className="mb-3 text-sm font-extrabold text-ink-900">✏️ Jot one down</h3>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-start gap-2">
        <div className="flex flex-col">
          <input
            type="date"
            value={date}
            max={todayISO()}
            onChange={(e) => setDate(e.target.value)}
            className="field"
            aria-label="Date"
          />
          {errors.date && <span className="mt-1 text-xs font-bold text-brand-600">{errors.date}</span>}
        </div>
        <div className="flex min-w-40 flex-1 flex-col">
          <input
            type="text"
            placeholder="What was it? (e.g. TRADER JOE'S #552)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="field"
            aria-label="Description"
          />
          {errors.description && <span className="mt-1 text-xs font-bold text-brand-600">{errors.description}</span>}
        </div>
        <div className="flex flex-col">
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="field w-24 text-right"
            aria-label="Amount"
          />
          {errors.amount && <span className="mt-1 w-44 text-xs font-bold text-brand-600">{errors.amount}</span>}
        </div>
        <div
          className="flex overflow-hidden rounded-2xl border-2 border-cream-200 text-sm font-extrabold"
          role="group"
          aria-label="Type"
        >
          {(["expense", "income"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`px-3 py-2 transition-colors ${
                type === t
                  ? t === "expense"
                    ? "bg-brand-500 text-white"
                    : "bg-grow-500 text-white"
                  : "bg-white text-ink-400 hover:text-ink-600"
              }`}
            >
              {t === "expense" ? "💸 spent" : "💰 earned"}
            </button>
          ))}
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="field" aria-label="Category">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryIcon(c)} {c}
            </option>
          ))}
        </select>
        <motion.button whileTap={{ scale: 0.95 }} type="submit" className="btn-primary">
          Add it!
        </motion.button>
      </form>
    </Card>
  );
}
