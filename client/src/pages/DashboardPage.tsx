import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { api, ApiError } from "../lib/api";
import { CATEGORIES, categoryIcon } from "../lib/categories";
import type { Settings, Summary, Transaction, TransactionPage } from "../lib/types";
import { Card } from "../components/Bits";
import { CategoryPie, SpendingBar } from "../components/Charts";
import { Reveal } from "../components/Reveal";
import { Tilt } from "../components/Tilt";
import { CategorizePanel } from "../components/CategorizePanel";
import { FlaggedSection } from "../components/FlaggedSection";
import { SuggestionsPanel } from "../components/SuggestionsPanel";
import { SummaryCards } from "../components/SummaryCards";
import { TransactionForm, type NewTransaction } from "../components/TransactionForm";
import { TransactionList } from "../components/TransactionList";
import { useToast } from "../components/Toast";

const currentMonth = () => new Date().toISOString().slice(0, 7);

export function DashboardPage({
  settings,
  autoCategorize,
  onAutoCategorizeConsumed,
  onGoToSettings,
}: {
  settings: Settings;
  autoCategorize: boolean;
  onAutoCategorizeConsumed: () => void;
  onGoToSettings: () => void;
}) {
  const symbol = settings.currency_symbol;
  const toast = useToast();

  const [month, setMonth] = useState(currentMonth());
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [txPage, setTxPage] = useState<TransactionPage | null>(null);
  const [txLoading, setTxLoading] = useState(true);
  const [flagged, setFlagged] = useState<Transaction[]>([]);
  const [uncategorized, setUncategorized] = useState<number | null>(null);

  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => setPage(1), [month, category, debouncedSearch]);

  useEffect(() => {
    let cancelled = false;
    setSummaryLoading(true);
    api
      .get<Summary>(`/api/summary?month=${month}`)
      .then((s) => !cancelled && setSummary(s))
      .catch((e) => !cancelled && toast("error", e instanceof ApiError ? e.message : "Couldn't load the summary"))
      .finally(() => !cancelled && setSummaryLoading(false));
    return () => {
      cancelled = true;
    };
  }, [month, refreshKey, toast]);

  useEffect(() => {
    let cancelled = false;
    setTxLoading(true);
    const params = new URLSearchParams({ month, page: String(page) });
    if (category) params.set("category", category);
    if (debouncedSearch) params.set("search", debouncedSearch);
    api
      .get<TransactionPage>(`/api/transactions?${params}`)
      .then((p) => !cancelled && setTxPage(p))
      .catch((e) => !cancelled && toast("error", e instanceof ApiError ? e.message : "Couldn't load transactions"))
      .finally(() => !cancelled && setTxLoading(false));
    return () => {
      cancelled = true;
    };
  }, [month, category, debouncedSearch, page, refreshKey, toast]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<TransactionPage>("/api/transactions?flagged=1")
      .then((p) => !cancelled && setFlagged(p.rows));
    api
      .get<TransactionPage>("/api/transactions?category=Uncategorized")
      .then((p) => !cancelled && setUncategorized(p.total));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // Manual add with optimistic UI + rollback (requirements 4.1).
  async function handleAdd(t: NewTransaction) {
    const optimistic: Transaction = {
      id: -Date.now(),
      ...t,
      category_source: "manual",
      flagged: 0,
      flag_reason: null,
      created_at: new Date().toISOString(),
    } as Transaction;
    const prev = txPage;
    if (txPage && t.date.startsWith(month)) {
      setTxPage({ ...txPage, total: txPage.total + 1, rows: [optimistic, ...txPage.rows].slice(0, txPage.page_size) });
    }
    try {
      await api.post("/api/transactions", t);
      toast(
        "success",
        t.amount_cents > 0 ? "Cha-ching! Income logged 💰" : "Nice, got it written down! ✏️"
      );
      refetch();
    } catch (e) {
      setTxPage(prev); // rollback
      toast("error", e instanceof ApiError ? e.message : "That one didn't stick — try again?");
    }
  }

  async function handleCategoryChange(tx: Transaction, newCategory: string) {
    if (newCategory === tx.category) return;
    try {
      await api.patch(`/api/transactions/${tx.id}`, { category: newCategory });
      toast("success", `Filed under ${categoryIcon(newCategory)} ${newCategory} — we'll remember that merchant!`);
      refetch();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Couldn't update the category");
    }
  }

  async function handleDelete(tx: Transaction) {
    if (!window.confirm(`Delete "${tx.description}" (${tx.date})?`)) return;
    try {
      await api.del(`/api/transactions/${tx.id}`);
      toast("success", "Poof — it's gone 💨");
      refetch();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Couldn't delete that one");
    }
  }

  const monthLabel = useMemo(
    () =>
      new Date(`${month}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
    [month]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="month"
          value={month}
          max={currentMonth()}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
          className="field"
          aria-label="Month"
        />
        <CategorizePanel
          uncategorizedHint={uncategorized}
          autoStart={autoCategorize}
          onAutoStartConsumed={onAutoCategorizeConsumed}
          onFinished={refetch}
        />
      </div>

      <SummaryCards summary={summary} symbol={symbol} loading={summaryLoading} />

      <FlaggedSection flagged={flagged} symbol={symbol} onChanged={refetch} />

      {/* keyed by month so switching months crossfades instead of snapping */}
      <motion.div
        key={month}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="grid gap-4 lg:grid-cols-2"
      >
        <Tilt>
          <Card className="h-full">
            <h3 className="mb-2 text-sm font-extrabold text-ink-900">🎨 Where {monthLabel} went</h3>
            <CategoryPie data={summary?.by_category ?? []} symbol={symbol} />
          </Card>
        </Tilt>
        <Tilt>
          <Card className="h-full">
            <h3 className="mb-2 text-sm font-extrabold text-ink-900">📈 The last six months</h3>
            <SpendingBar data={summary?.six_month_series ?? []} symbol={symbol} />
          </Card>
        </Tilt>
      </motion.div>

      <Reveal distance={20}>
        <SuggestionsPanel month={month} onNeedsIncome={onGoToSettings} />
      </Reveal>

      <Reveal distance={32} delay={0.05}>
        <TransactionForm onSubmit={handleAdd} />
      </Reveal>

      <Reveal distance={26}>
      <Card className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b-2 border-cream-100 p-3">
          <h3 className="mr-auto text-sm font-extrabold text-ink-900">🧾 The ledger</h3>
          <input
            type="search"
            placeholder="Search descriptions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="field"
            aria-label="Search descriptions"
          />
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="field" aria-label="Filter by category">
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryIcon(c)} {c}
              </option>
            ))}
          </select>
        </div>
        <TransactionList
          page={txPage}
          loading={txLoading}
          symbol={symbol}
          onPageChange={setPage}
          onCategoryChange={handleCategoryChange}
          onDelete={handleDelete}
        />
      </Card>
      </Reveal>
    </div>
  );
}
