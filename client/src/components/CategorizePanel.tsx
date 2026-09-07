import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { api, ApiError } from "../lib/api";
import { sprinkle } from "../lib/confetti";
import type { RunStatus } from "../lib/types";
import { useToast } from "./Toast";

/**
 * Kicks off a categorization run and polls /api/categorize/status once a
 * second while it's running. Same logic as before — now with an animated
 * progress bar and a confetti sprinkle when labels land.
 */
export function CategorizePanel({
  uncategorizedHint,
  autoStart,
  onAutoStartConsumed,
  onFinished,
}: {
  uncategorizedHint: number | null;
  autoStart?: boolean;
  onAutoStartConsumed?: () => void;
  onFinished: () => void;
}) {
  const [run, setRun] = useState<RunStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const toast = useToast();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStarted = useRef(false);

  const running = run?.status === "running";

  function stopPolling() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }

  function poll() {
    stopPolling();
    timer.current = setInterval(async () => {
      try {
        const status = await api.get<RunStatus>("/api/categorize/status");
        setRun(status);
        if (status.status !== "running") {
          stopPolling();
          if (status.errors.length) toast("error", status.errors[0]);
          else if (status.ai_count + status.cached_count > 0) {
            toast(
              "success",
              `Sorted ${status.ai_count + status.cached_count} transactions! ${
                status.cached_count > 0 ? `(${status.cached_count} were old friends from the cache)` : ""
              }`
            );
            sprinkle();
          }
          onFinished();
        }
      } catch {
        // transient poll failure — keep trying until the run resolves
      }
    }, 1000);
  }

  async function start() {
    setStarting(true);
    try {
      await api.post("/api/categorize");
      const status = await api.get<RunStatus>("/api/categorize/status");
      setRun(status);
      if (status.status === "running") poll();
      else {
        if (status.errors.length) toast("error", status.errors[0]);
        onFinished();
      }
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Couldn't start categorization");
    } finally {
      setStarting(false);
    }
  }

  useEffect(() => {
    // Resume polling if a run is already in flight (e.g. after a page nav).
    api.get<RunStatus>("/api/categorize/status").then((s) => {
      setRun(s);
      if (s.status === "running") poll();
    });
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (autoStart && !autoStarted.current && !running) {
      autoStarted.current = true;
      onAutoStartConsumed?.();
      void start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  const progress =
    run && run.batches_total > 0 ? Math.min(1, run.batches_done / run.batches_total) : 0;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <motion.button
        whileTap={{ scale: 0.95 }}
        type="button"
        onClick={start}
        disabled={running || starting || uncategorizedHint === 0}
        className="btn-spark"
        title={
          uncategorizedHint === 0
            ? "Everything already has a label — nice!"
            : "Let AI label everything that needs one"
        }
      >
        {running ? "Sorting the pile…" : "✨ Auto-label"}
      </motion.button>
      <AnimatePresence>
        {running && run && (
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2"
            role="status"
          >
            {run.batches_total > 0 && (
              <div className="h-2.5 w-28 overflow-hidden rounded-full bg-spark-100">
                <motion.div
                  className="h-full rounded-full bg-spark-500"
                  animate={{ width: `${Math.max(8, progress * 100)}%` }}
                  transition={{ type: "spring", stiffness: 120, damping: 20 }}
                />
              </div>
            )}
            <span className="text-sm font-bold text-ink-600">
              {run.batches_total > 0
                ? `Batch ${Math.min(run.batches_done + 1, run.batches_total)} of ${run.batches_total}…`
                : "Checking old friends in the cache…"}
              {run.cached_count > 0 && ` ${run.cached_count} matched instantly ⚡`}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      {uncategorizedHint != null && uncategorizedHint > 0 && !running && (
        // ink-900, not the usual ink-400 muted tone: this sits directly on
        // the page (no card behind it), right where Backdrop.tsx's
        // top-left drift blob passes through -- same reasoning as
        // App.tsx's tagline and SummaryCards.tsx's "flagged" count.
        <span className="text-sm font-bold text-ink-900">
          {uncategorizedHint} waiting for a label
        </span>
      )}
    </div>
  );
}
