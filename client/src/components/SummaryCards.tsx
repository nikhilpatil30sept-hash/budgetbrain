import { motion } from "framer-motion";
import type { Summary } from "../lib/types";
import { AnimatedCents, AnimatedInt } from "./AnimatedNumber";
import { Skeleton } from "./Bits";
import { Tilt } from "./Tilt";

/**
 * The four headline tiles: frosted glass over the drifting backdrop, money
 * counts up, and each tile tilts toward the cursor.
 */
export function SummaryCards({
  summary,
  symbol,
  loading,
}: {
  summary: Summary | null;
  symbol: string;
  loading: boolean;
}) {
  const net = summary?.net_cents ?? 0;
  const cards = [
    {
      label: "Spent this month",
      icon: "💸",
      tint: "bg-brand-50/60",
      body: summary && <AnimatedCents cents={summary.spent_cents} symbol={symbol} className="text-ink-900" />,
    },
    {
      label: "Earned this month",
      icon: "💰",
      tint: "bg-grow-50/60",
      body: summary && <AnimatedCents cents={summary.income_cents} symbol={symbol} className="text-grow-600" />,
    },
    {
      label: net < 0 ? "Net — in the red" : "Net — nice and green",
      icon: net < 0 ? "🫣" : "🌱",
      tint: net < 0 ? "bg-honey-50/60" : "bg-grow-50/60",
      body: summary && (
        <AnimatedCents cents={summary.net_cents} symbol={symbol} className={net < 0 ? "text-honey-700" : "text-grow-600"} />
      ),
    },
    {
      label: "Worth a look",
      icon: "👀",
      tint: "bg-spark-100/50",
      body: summary && (
        <span>
          <AnimatedInt value={summary.flagged_count} className="text-spark-600" />
          <span className="ml-1.5 text-sm font-bold text-ink-900">flagged</span> {/* ink-900, not ink-400/600: same reasoning as App.tsx's tagline -- this card sits over a drifting translucent blob, and ink-600 alone doesn't clear 4.5:1 at the lightest point of that animation */}
        </span>
      ),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c, i) => (
        <motion.div
          key={c.label}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06, type: "spring", stiffness: 300, damping: 24 }}
        >
          <Tilt className={`h-full rounded-blob border border-white/60 p-4 backdrop-blur-xl ${c.tint}`}>
            <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-ink-600">
              <span aria-hidden>{c.icon}</span>
              {c.label}
            </p>
            {loading || !summary ? (
              <Skeleton className="mt-2 h-8 w-24" />
            ) : (
              <p className="mt-1 text-2xl font-extrabold">{c.body}</p>
            )}
          </Tilt>
        </motion.div>
      ))}
    </div>
  );
}
