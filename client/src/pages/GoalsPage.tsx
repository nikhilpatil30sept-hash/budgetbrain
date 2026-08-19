import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { api, ApiError } from "../lib/api";
import { sprinkle } from "../lib/confetti";
import { formatCents, parsePositiveAmountToCents } from "../lib/money";
import type { Goal } from "../lib/types";
import { Card, EmptyState, Skeleton } from "../components/Bits";
import { CoinJar } from "../components/CoinJar";
import { Tilt } from "../components/Tilt";
import { useToast } from "../components/Toast";

const STATUS_META: Record<Goal["status"], { label: string; cls: string; bar: string }> = {
  done: { label: "🏆 You did it!", cls: "bg-grow-50 text-grow-700", bar: "bg-grow-500" },
  on_track: { label: "🚀 On track", cls: "bg-grow-50 text-grow-700", bar: "bg-grow-500" },
  behind: { label: "🐢 A little behind", cls: "bg-honey-50 text-honey-700", bar: "bg-honey-500" },
  not_reachable: { label: "🧗 Needs a bigger push", cls: "bg-brand-50 text-brand-600", bar: "bg-brand-400" },
};

/**
 * Module 3 — savings goals. Progress = net savings since the goal was
 * created; velocity = average weekly net savings over the trailing 8 weeks.
 * Bars fill up with a spring; goals at ≥90% get a confetti sprinkle.
 */
export function GoalsPage({ symbol }: { symbol: string }) {
  const toast = useToast();
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [velocity, setVelocity] = useState(0);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [deadline, setDeadline] = useState("");
  const [saving, setSaving] = useState(false);
  const celebrated = useRef(false);

  const load = useCallback(() => {
    api
      .get<{ velocity_weekly_cents: number; goals: Goal[] }>("/api/goals")
      .then((res) => {
        setGoals(res.goals);
        setVelocity(res.velocity_weekly_cents);
        const nearDone = res.goals.some(
          (g) => g.target_cents > 0 && g.saved_cents / g.target_cents >= 0.9
        );
        if (nearDone && !celebrated.current) {
          celebrated.current = true;
          setTimeout(sprinkle, 700); // let the bar fill first
        }
      })
      .catch((e) => toast("error", e instanceof ApiError ? e.message : "Couldn't load goals"));
  }, [toast]);

  useEffect(load, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const cents = parsePositiveAmountToCents(target);
    if (!name.trim()) return toast("error", "Give the goal a name — dream a little!");
    if (cents === null) return toast("error", "Target needs to be a positive amount");
    if (!deadline) return toast("error", "Pick a deadline to aim for");
    setSaving(true);
    try {
      await api.post("/api/goals", { name: name.trim(), target_cents: cents, deadline });
      setName("");
      setTarget("");
      setDeadline("");
      toast("success", "New goal on the board! 🎯");
      load();
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "Couldn't create the goal");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(goal: Goal) {
    if (!window.confirm(`Delete goal "${goal.name}"?`)) return;
    try {
      await api.del(`/api/goals/${goal.id}`);
      toast("success", "Goal retired 🫡");
      load();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Couldn't delete the goal");
    }
  }

  const totalTarget = (goals ?? []).reduce((s, g) => s + g.target_cents, 0);
  const totalSaved = (goals ?? []).reduce((s, g) => s + g.saved_cents, 0);
  const overallProgress = totalTarget > 0 ? totalSaved / totalTarget : 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr,280px]">
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-extrabold text-ink-900">🎯 Savings goals</h2>
          <p className="text-sm font-bold text-ink-600">
            Your pace:{" "}
            <span className={`font-extrabold tabular-nums ${velocity >= 0 ? "text-grow-600" : "text-brand-600"}`}>
              {formatCents(velocity, symbol)}/week
            </span>{" "}
            <span className="font-medium text-ink-400">(avg net savings, last 8 weeks)</span>
          </p>
        </div>
        <form onSubmit={handleCreate} className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Goal name (e.g. Trip to Tokyo 🗼)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field min-w-48 flex-1"
          />
          <input
            type="text"
            inputMode="decimal"
            placeholder="Target (e.g. 5000)"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="field w-36 text-right"
          />
          <input
            type="date"
            value={deadline}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDeadline(e.target.value)}
            className="field"
          />
          <motion.button whileTap={{ scale: 0.95 }} type="submit" disabled={saving} className="btn-grow">
            Add goal
          </motion.button>
        </form>
      </Card>

      <Tilt>
        <Card className="h-full">
          <h3 className="text-center text-sm font-extrabold text-ink-900">🫙 The savings jar</h3>
          {goals !== null && goals.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 py-6 text-center">
              <span className="text-4xl animate-float" aria-hidden>
                🫙
              </span>
              <p className="text-xs font-bold text-ink-400">Add a goal and start filling it up!</p>
            </div>
          ) : (
            <CoinJar progress={overallProgress} />
          )}
        </Card>
      </Tilt>
      </div>

      {goals === null ? (
        <Card>
          <Skeleton className="h-24 w-full" />
        </Card>
      ) : goals.length === 0 ? (
        <Card>
          <EmptyState
            icon="🌈"
            title="What are you saving for?"
            hint="A trip, a cushion, a guitar… name it above and BudgetBrain will tell you exactly what to put away each week."
          />
        </Card>
      ) : (
        goals.map((g, gi) => {
          const pct = g.target_cents > 0 ? Math.min(100, Math.round((g.saved_cents / g.target_cents) * 100)) : 0;
          const meta = STATUS_META[g.status];
          const almostThere = g.status !== "done" && pct >= 90;
          return (
            <motion.div
              key={g.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: gi * 0.08 }}
            >
              <Card hover>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-extrabold text-ink-900">{g.name}</h3>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-extrabold ${meta.cls}`}>
                    {almostThere ? "🔥 So close!" : meta.label}
                  </span>
                  <span className="ml-auto text-sm font-bold text-ink-400">
                    due {g.deadline} · {g.weeks_left} wk left
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDelete(g)}
                    className="rounded-full px-1.5 text-xs font-bold text-ink-400 transition-colors hover:text-brand-600"
                    aria-label={`Delete ${g.name}`}
                  >
                    ✕
                  </button>
                </div>
                <div className="relative mt-3 h-5 overflow-hidden rounded-full bg-cream-100">
                  <motion.div
                    className={`h-full rounded-full ${meta.bar}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ type: "spring", stiffness: 60, damping: 16, delay: 0.2 + gi * 0.1 }}
                  />
                  {pct >= 12 && (
                    <span className="absolute inset-y-0 left-2 flex items-center text-[11px] font-extrabold text-white drop-shadow">
                      {pct}%
                    </span>
                  )}
                </div>
                <div className="mt-2 grid gap-2 text-sm font-medium text-ink-600 sm:grid-cols-4">
                  <span>
                    Saved{" "}
                    <span className="font-extrabold tabular-nums text-ink-900">{formatCents(g.saved_cents, symbol)}</span>{" "}
                    of {formatCents(g.target_cents, symbol)}
                  </span>
                  <span>
                    Needs{" "}
                    <span className="font-extrabold tabular-nums text-ink-900">
                      {g.required_weekly_cents === null
                        ? "— (past deadline)"
                        : `${formatCents(g.required_weekly_cents, symbol)}/wk`}
                    </span>
                  </span>
                  <span>
                    Your pace{" "}
                    <span className="font-extrabold tabular-nums text-ink-900">
                      {formatCents(g.velocity_weekly_cents, symbol)}/wk
                    </span>
                  </span>
                  <span>
                    Landing{" "}
                    <span className="font-extrabold tabular-nums text-ink-900">
                      {g.projected_completion ?? "not at this pace 😅"}
                    </span>
                  </span>
                </div>
              </Card>
            </motion.div>
          );
        })
      )}
    </div>
  );
}
