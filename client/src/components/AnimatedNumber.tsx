import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";
import { formatCents } from "../lib/money";

/**
 * Money that counts up (or down) to its new value instead of snapping.
 * Formatting stays integer-cents-exact — the tween runs on cents and every
 * displayed frame goes through formatCents.
 */
export function AnimatedCents({
  cents,
  symbol,
  className = "",
}: {
  cents: number;
  symbol: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? cents : 0);
  const prev = useRef(reduced ? cents : 0);

  useEffect(() => {
    if (reduced) {
      prev.current = cents;
      setShown(cents);
      return;
    }
    const controls = animate(prev.current, cents, {
      duration: 0.8,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setShown(Math.round(v)),
    });
    prev.current = cents;
    return () => controls.stop();
  }, [cents, reduced]);

  return (
    <span className={`tabular-nums ${className}`}>{formatCents(shown, symbol)}</span>
  );
}

/** Same idea for plain integers (counts, not money). */
export function AnimatedInt({ value, className = "" }: { value: number; className?: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  const prev = useRef(reduced ? value : 0);

  useEffect(() => {
    if (reduced) {
      prev.current = value;
      setShown(value);
      return;
    }
    const controls = animate(prev.current, value, {
      duration: 0.6,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setShown(Math.round(v)),
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, reduced]);

  return <span className={`tabular-nums ${className}`}>{shown}</span>;
}
