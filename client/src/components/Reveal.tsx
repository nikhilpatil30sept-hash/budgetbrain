import type { ReactNode } from "react";
import { motion } from "framer-motion";

/**
 * Fade+slide a section in the first time it scrolls into view. Once only —
 * this is a dashboard, not a story page. `distance` varies per section so
 * neighbors move at slightly different speeds (cheap depth).
 */
export function Reveal({
  children,
  className = "",
  distance = 24,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  distance?: number;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: distance }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
