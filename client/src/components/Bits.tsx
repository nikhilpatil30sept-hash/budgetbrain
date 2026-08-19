import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { categoryColor, categoryIcon, categoryTint } from "../lib/categories";

/** Shared playful pieces: cards, empty states, skeletons, badges. */

export function Card({
  children,
  className = "",
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return (
    <div
      className={`glass rounded-blob p-4 transition-all duration-200 ${
        hover ? "hover:-translate-y-0.5 hover:shadow-lift" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  icon = "🌱",
  action,
}: {
  title: string;
  hint?: string;
  icon?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <motion.div
        initial={{ scale: 0, rotate: -12 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 16 }}
        className="grid h-20 w-20 place-items-center rounded-full bg-cream-100 text-4xl shadow-soft animate-float"
        aria-hidden
      >
        {icon}
      </motion.div>
      <p className="mt-2 text-base font-extrabold text-ink-900">{title}</p>
      {hint && <p className="max-w-sm text-sm font-medium text-ink-600">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-shimmer rounded-2xl bg-gradient-to-r from-cream-100 via-cream-200 to-cream-100 bg-[length:200%_100%] ${className}`}
    />
  );
}

/**
 * The one true category badge — same color + emoji for a category
 * everywhere in the app. `pop` replays the entrance spring (used when AI
 * assigns a fresh category so badges visibly land one by one).
 */
export function CategoryBadge({
  category,
  pop = false,
  delay = 0,
}: {
  category: string;
  pop?: boolean;
  delay?: number;
}) {
  const color = categoryColor(category);
  const dashed = category === "Uncategorized";
  return (
    <motion.span
      initial={pop ? { scale: 0, rotate: -8 } : false}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 18, delay }}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-extrabold ${
        dashed ? "border-2 border-dashed" : ""
      }`}
      style={{ backgroundColor: categoryTint(category, dashed ? "00" : "24"), color, borderColor: color }}
    >
      <span aria-hidden>{categoryIcon(category)}</span>
      {category === "Uncategorized" ? "Needs a label" : category}
    </motion.span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink-600">
      <span className="h-4 w-4 animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-500" />
      {label}
    </span>
  );
}
