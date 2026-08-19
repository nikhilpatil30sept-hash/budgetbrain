export interface Transaction {
  id: number;
  date: string;
  description: string;
  amount_cents: number;
  category: string;
  category_source: "manual" | "ai" | "cache";
  flagged: 0 | 1;
  flag_reason: string | null;
  created_at: string;
}

export interface TransactionPage {
  rows: Transaction[];
  total: number;
  page: number;
  page_size: number;
  page_count: number;
}

export interface Summary {
  month: string;
  spent_cents: number;
  income_cents: number;
  net_cents: number;
  flagged_count: number;
  by_category: { category: string; spent_cents: number }[];
  six_month_series: { month: string; spent_cents: number }[];
}

export interface Settings {
  monthly_income_cents: number | null;
  currency_symbol: string;
}

export interface RunStatus {
  run_id: string | null;
  status: "idle" | "running" | "done";
  total_transactions: number;
  cached_count: number;
  ai_count: number;
  fallback_count: number;
  batches_total: number;
  batches_done: number;
  batches_skipped: number;
  errors: string[];
  started_at: string | null;
  finished_at: string | null;
}

export interface Goal {
  id: number;
  name: string;
  target_cents: number;
  deadline: string;
  created_at: string;
  saved_cents: number;
  remaining_cents: number;
  weeks_left: number;
  required_weekly_cents: number | null;
  velocity_weekly_cents: number;
  projected_completion: string | null;
  status: "done" | "on_track" | "behind" | "not_reachable";
}

export interface ImportResult {
  imported: number;
  skipped: { row: number; reason: string }[];
  duplicates: { row: number; description: string }[];
}
