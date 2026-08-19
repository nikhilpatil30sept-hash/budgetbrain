import { useRef, type ReactNode } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";

/**
 * Cursor-reactive 3D tilt (max ~6°) with a lift shadow, on springs so it
 * flows instead of snapping. Disabled entirely for reduced-motion users.
 * Purely presentational — children keep all their own behavior.
 */
export function Tilt({ children, className = "" }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0.5); // pointer position within the card, 0..1
  const py = useMotionValue(0.5);
  const hovered = useMotionValue(0);
  const spring = { stiffness: 220, damping: 22, mass: 0.6 };
  const rotateX = useSpring(useTransform(py, [0, 1], [6, -6]), spring);
  const rotateY = useSpring(useTransform(px, [0, 1], [-6, 6]), spring);
  const lift = useSpring(hovered, spring);
  const shadow = useTransform(
    lift,
    [0, 1],
    ["0 2px 12px rgba(59,47,42,0.06)", "0 18px 40px rgba(59,47,42,0.16)"]
  );

  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      ref={ref}
      onMouseEnter={() => hovered.set(1)}
      onMouseMove={(e) => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        px.set((e.clientX - r.left) / r.width);
        py.set((e.clientY - r.top) / r.height);
      }}
      onMouseLeave={() => {
        hovered.set(0);
        px.set(0.5);
        py.set(0.5);
      }}
      style={{ rotateX, rotateY, boxShadow: shadow, transformPerspective: 900 }}
      whileHover={{ scale: 1.01 }}
      className={`rounded-blob will-change-transform ${className}`}
    >
      {children}
    </motion.div>
  );
}
