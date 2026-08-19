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

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}
