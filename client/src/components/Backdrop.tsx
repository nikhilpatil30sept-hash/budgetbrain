import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";

/**
 * The living background: 4 big, soft color blobs drifting at lava-lamp pace
 * behind everything. Drift is pure CSS keyframes (transform-only, GPU
 * cheap); scroll adds a whisper of parallax per blob. With reduced motion
 * the blobs stay — pretty but perfectly still.
 */
export function Backdrop() {
  const reduced = useReducedMotion();
  const { scrollY } = useScroll();
  // Different scroll speeds per blob = depth. Kept tiny on purpose.
  const y1 = useTransform(scrollY, [0, 1200], [0, -90]);
  const y2 = useTransform(scrollY, [0, 1200], [0, 60]);
  const y3 = useTransform(scrollY, [0, 1200], [0, -40]);

  const blobs = [
    {
      cls: "blob-drift-a left-[-12%] top-[-14%] h-[55vw] w-[55vw] bg-brand-300/50",
      y: y1,
    },
    {
      cls: "blob-drift-b right-[-15%] top-[8%] h-[48vw] w-[48vw] bg-spark-500/25",
      y: y2,
    },
    {
      cls: "blob-drift-c left-[15%] bottom-[-25%] h-[50vw] w-[50vw] bg-honey-500/25",
      y: y3,
    },
    {
      cls: "blob-drift-b right-[8%] bottom-[-18%] h-[38vw] w-[38vw] bg-grow-500/20",
      y: y1,
    },
  ];

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      {blobs.map((b, i) => (
        <motion.div key={i} style={reduced ? undefined : { y: b.y }} className="absolute inset-0">
          <div className={`absolute rounded-full blur-3xl will-change-transform ${b.cls}`} />
        </motion.div>
      ))}
    </div>
  );
}
