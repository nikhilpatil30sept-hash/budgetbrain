import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "./lib/api";
import type { Settings } from "./lib/types";
import { Backdrop } from "./components/Backdrop";
import { Card, Skeleton } from "./components/Bits";
import { DashboardPage } from "./pages/DashboardPage";
import { GoalsPage } from "./pages/GoalsPage";
import { ImportPage } from "./pages/ImportPage";
import { SettingsPage } from "./pages/SettingsPage";

type Tab = "dashboard" | "import" | "goals" | "settings";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "🏠" },
  { id: "import", label: "Import", icon: "📥" },
  { id: "goals", label: "Goals", icon: "🎯" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [health, setHealth] = useState<{ ok: boolean; gemini_key_configured: boolean } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Set when the import flow hands off to the dashboard with "categorize now".
  const [autoCategorize, setAutoCategorize] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<{ ok: boolean; gemini_key_configured: boolean }>("/api/health"),
      api.get<Settings>("/api/settings"),
    ])
      .then(([h, s]) => {
        setHealth(h);
        setSettings(s);
      })
      .catch(() => setLoadError("Can't reach the BudgetBrain server. Is `npm run dev` running?"));
  }, []);

  if (loadError) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <Card className="border-brand-200 bg-brand-50">
          <h1 className="text-lg font-extrabold text-brand-700">😴 The server's not answering</h1>
          <p className="mt-1 text-sm font-medium text-ink-600">{loadError}</p>
          <button type="button" onClick={() => window.location.reload()} className="btn-primary mt-3">
            Try again
          </button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16">
      <Backdrop />
      <header className="flex flex-wrap items-center gap-4 py-5">
        <motion.h1
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2.5 text-xl font-extrabold tracking-tight text-ink-900"
        >
          <motion.span
            whileHover={{ rotate: [0, -8, 8, 0], transition: { duration: 0.5 } }}
            className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-2xl shadow-soft"
            aria-hidden
          >
            🧠
          </motion.span>
          <span>
            Budget<span className="text-brand-500">Brain</span>
            <span className="block text-[11px] font-bold leading-tight text-ink-400">
              your money, but friendlier
            </span>
          </span>
        </motion.h1>
        <nav className="ml-auto flex gap-1 rounded-2xl border border-white/60 bg-white/60 p-1 shadow-soft backdrop-blur-xl">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`relative rounded-xl px-3 py-1.5 text-sm font-extrabold transition-colors ${
                tab === t.id ? "text-white" : "text-ink-600 hover:text-brand-600"
              }`}
            >
              {tab === t.id && (
                <motion.span
                  layoutId="active-tab"
                  className="absolute inset-0 rounded-xl bg-brand-500"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <span className="relative">
                <span aria-hidden>{t.icon}</span> {t.label}
              </span>
            </button>
          ))}
        </nav>
      </header>

      {health && !health.gemini_key_configured && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 rounded-blob border-2 border-spark-100 bg-spark-100/60 px-4 py-3 text-sm font-semibold text-spark-600"
        >
          🔮 No Gemini key yet — everything works except auto-labeling and the budget coach. Copy{" "}
          <code className="rounded-md bg-white/70 px-1 font-mono text-xs">server/.env.example</code> to{" "}
          <code className="rounded-md bg-white/70 px-1 font-mono text-xs">server/.env</code> and drop in your free key.
        </motion.div>
      )}

      {!settings ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-2 h-8 w-20" />
              </Card>
            ))}
          </div>
          <Card>
            <Skeleton className="h-56 w-full" />
          </Card>
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.main
            key={tab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            {tab === "dashboard" && (
              <DashboardPage
                settings={settings}
                autoCategorize={autoCategorize}
                onAutoCategorizeConsumed={() => setAutoCategorize(false)}
                onGoToSettings={() => setTab("settings")}
              />
            )}
            {tab === "import" && (
              <ImportPage
                onImported={(categorizeNow) => {
                  setAutoCategorize(categorizeNow);
                  setTab("dashboard");
                }}
              />
            )}
            {tab === "goals" && <GoalsPage symbol={settings.currency_symbol} />}
            {tab === "settings" && (
              <SettingsPage
                settings={settings}
                onSaved={(s) => {
                  setSettings(s);
                  setTab("dashboard");
                }}
              />
            )}
          </motion.main>
        </AnimatePresence>
      )}
    </div>
  );
}
