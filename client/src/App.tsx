import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { api, ApiError } from "./lib/api";
import type { Settings, User } from "./lib/types";
import { Backdrop } from "./components/Backdrop";
import { Card, Skeleton } from "./components/Bits";
import { DashboardPage } from "./pages/DashboardPage";
import { GoalsPage } from "./pages/GoalsPage";
import { ImportPage } from "./pages/ImportPage";
import { SettingsPage } from "./pages/SettingsPage";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";

type Tab = "dashboard" | "import" | "goals" | "settings";
type AuthView = "login" | "signup" | "forgot";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "🏠" },
  { id: "import", label: "Import", icon: "📥" },
  { id: "goals", label: "Goals", icon: "🎯" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

// A password-reset link (from the email) lands here as ?reset_token=..., no
// matter whether this browser currently has an active session or not.
function readResetToken(): string | null {
  return new URLSearchParams(window.location.search).get("reset_token");
}

function clearResetTokenFromUrl() {
  window.history.replaceState(null, "", window.location.pathname);
}

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [health, setHealth] = useState<{ ok: boolean; gemini_key_configured: boolean } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Set when the import flow hands off to the dashboard with "categorize now".
  const [autoCategorize, setAutoCategorize] = useState(false);

  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authView, setAuthView] = useState<AuthView>("login");
  const [resetToken, setResetToken] = useState<string | null>(() => readResetToken());

  // Is there already a logged-in session (a cookie from an earlier visit)?
  // This has to resolve before we know whether to show the app or the
  // login screen.
  useEffect(() => {
    api
      .get<User>("/api/auth/me")
      .then((u) => setUser(u))
      .catch((err) => {
        // A real network failure (server not running) is a different
        // problem than "not logged in" — don't show the login form for it.
        if (err instanceof ApiError && err.status === 0) {
          setLoadError(err.message);
        }
        setUser(null);
      })
      .finally(() => setAuthChecked(true));
  }, []);

  // Only fetch the rest of the app's data once someone's actually logged in
  // — these routes now require a session.
  useEffect(() => {
    if (!user) return;
    Promise.all([
      api.get<{ ok: boolean; gemini_key_configured: boolean }>("/api/health"),
      api.get<Settings>("/api/settings"),
    ])
      .then(([h, s]) => {
        setHealth(h);
        setSettings(s);
      })
      .catch(() => setLoadError("Can't reach the BudgetBrain server. Is `npm run dev` running?"));
  }, [user]);

  function handleAuthed(u: User) {
    setUser(u);
    setSettings(null);
    setHealth(null);
    setTab("dashboard");
    if (resetToken) {
      setResetToken(null);
      clearResetTokenFromUrl();
    }
  }

  async function handleLogout() {
    try {
      await api.post("/api/auth/logout");
    } catch {
      // Best-effort — clear local state either way so the UI never gets
      // stuck showing someone else's data.
    }
    setUser(null);
    setSettings(null);
    setHealth(null);
    setAuthView("login");
  }

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

  // A reset link takes priority over everything else below — someone can
  // land here whether or not their browser still has an active session.
  if (resetToken) {
    return (
      <ResetPasswordPage
        token={resetToken}
        onReset={handleAuthed}
        onGoToLogin={() => {
          setResetToken(null);
          clearResetTokenFromUrl();
        }}
      />
    );
  }

  if (!authChecked) {
    return (
      <div className="mx-auto max-w-md p-8">
        <Card>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-3 h-10 w-full" />
          <Skeleton className="mt-3 h-10 w-full" />
        </Card>
      </div>
    );
  }

  if (!user) {
    if (authView === "signup") {
      return <SignupPage onSignedUp={handleAuthed} onGoToLogin={() => setAuthView("login")} />;
    }
    if (authView === "forgot") {
      return <ForgotPasswordPage onGoToLogin={() => setAuthView("login")} />;
    }
    return (
      <LoginPage
        onLoggedIn={handleAuthed}
        onGoToSignup={() => setAuthView("signup")}
        onGoToForgot={() => setAuthView("forgot")}
      />
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
            {/* ink-900, not the usual ink-400/600 muted tones: this sits over
                the header's perpetually-drifting translucent color blobs
                (see Backdrop.tsx), not a plain card surface. ink-600 still
                only clears 4.36:1 against the lightest point the blob drifts
                to (needs 4.5), and since the background keeps moving there's
                no single "safe" frame to target -- ink-900 clears it with
                real margin (8.9:1+) no matter where the blobs are. */}
            <span className="block text-[11px] font-bold leading-tight text-ink-900">
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
        <button type="button" onClick={handleLogout} className="btn-ghost" title={user.email}>
          Log out
        </button>
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
