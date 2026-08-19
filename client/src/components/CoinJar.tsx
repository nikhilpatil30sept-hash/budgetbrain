import { lazy, Suspense, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";

// The whole three.js/R3F bundle lives in this lazy chunk — the dashboard
// never waits on it, and it's only fetched when the Goals tab renders.
const CoinJarScene = lazy(() => import("./CoinJarScene"));

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Flat illustration — shown while the 3D chunk loads, when WebGL is
 *  unavailable, and for reduced-motion users. Still fills with progress. */
function FlatJar({ progress }: { progress: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-4">
      <div className="relative h-36 w-28 overflow-hidden rounded-b-[2.5rem] rounded-t-xl border-4 border-cream-200 bg-white/50">
        <div className="absolute inset-x-0 top-0 h-2 bg-brand-300/70" />
        <motion.div
          initial={{ height: 0 }}
          animate={{ height: `${pct}%` }}
          transition={{ type: "spring", stiffness: 50, damping: 16 }}
          className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-honey-500 to-[#FFC800]"
        />
        <span className="absolute inset-0 grid place-items-center text-3xl" aria-hidden>
          🪙
        </span>
      </div>
    </div>
  );
}

/**
 * The savings jar centerpiece. `progress` is 0..1 (overall saved ÷ overall
 * target across all goals).
 */
export function CoinJar({ progress }: { progress: number }) {
  const reduced = useReducedMotion();
  const webgl = useMemo(webglAvailable, []);
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);

  return (
    <div className="flex h-full flex-col">
      <div className="relative h-56 flex-1">
        {webgl && !reduced ? (
          <Suspense fallback={<FlatJar progress={progress} />}>
            <CoinJarScene progress={progress} />
          </Suspense>
        ) : (
          <FlatJar progress={progress} />
        )}
      </div>
      <p className="text-center text-sm font-extrabold text-ink-900">
        The jar is <span className="text-brand-600">{pct}% full</span>
      </p>
      <p className="text-center text-xs font-bold text-ink-400">across all your goals</p>
    </div>
  );
}
