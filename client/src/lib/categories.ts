export const CATEGORIES = [
  "Groceries",
  "Dining",
  "Entertainment",
  "Transport",
  "Utilities",
  "Rent/Mortgage",
  "Shopping",
  "Health",
  "Subscriptions",
  "Travel",
  "Income",
  "Transfers",
  "Fees",
  "Other",
  "Uncategorized",
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * Every category owns one color + emoji, used identically everywhere it
 * appears (pie slices, badges, list rows, legends). The Groceries green was
 * tuned to #2FA84F so the common Groceries↔Dining pie adjacency clears CVD
 * separation (validated ΔE 24.9); the three "misc" categories are
 * deliberately neutral. Icons ride along as the color-independent channel.
 */
interface CategoryStyle {
  color: string;
  icon: string;
}

const STYLES: Record<Category, CategoryStyle> = {
  Groceries: { color: "#2FA84F", icon: "🥕" },
  Dining: { color: "#FF9600", icon: "🍜" },
  Entertainment: { color: "#CE82FF", icon: "🎪" },
  Transport: { color: "#1CB0F6", icon: "🚌" },
  Utilities: { color: "#FFC800", icon: "💡" },
  "Rent/Mortgage": { color: "#FF4B4B", icon: "🏠" },
  Shopping: { color: "#FF86D0", icon: "🛍️" },
  Health: { color: "#2EC4B6", icon: "🩺" },
  Subscriptions: { color: "#7C5CFF", icon: "📺" },
  Travel: { color: "#0072CE", icon: "✈️" },
  Income: { color: "#00A86B", icon: "💰" },
  Transfers: { color: "#64748B", icon: "🔁" },
  Fees: { color: "#8B5E34", icon: "🧾" },
  Other: { color: "#A3A3A3", icon: "🎈" },
  Uncategorized: { color: "#94A3B8", icon: "🤔" },
};

export function categoryColor(category: string): string {
  return STYLES[category as Category]?.color ?? STYLES.Other.color;
}

export function categoryIcon(category: string): string {
  return STYLES[category as Category]?.icon ?? STYLES.Other.icon;
}

/** Soft tint of the category color for badge/row backgrounds (hex + alpha). */
export function categoryTint(category: string, alpha = "1A"): string {
  return `${categoryColor(category)}${alpha}`;
}
