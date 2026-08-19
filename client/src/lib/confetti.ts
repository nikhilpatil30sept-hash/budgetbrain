import confetti from "canvas-confetti";

const BRAND_COLORS = ["#FF6B35", "#FFC800", "#2FA84F", "#7C5CFF", "#1CB0F6", "#FF86D0"];

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Short, satisfying burst — imports, goals, big wins. */
export function celebrate() {
  if (reducedMotion()) return;
  confetti({
    particleCount: 90,
    spread: 75,
    startVelocity: 38,
    origin: { y: 0.7 },
    colors: BRAND_COLORS,
    disableForReducedMotion: true,
  });
}

/** Tiny sprinkle for smaller wins (categorization finished, goal on track). */
export function sprinkle() {
  if (reducedMotion()) return;
  confetti({
    particleCount: 30,
    spread: 55,
    startVelocity: 25,
    scalar: 0.8,
    origin: { y: 0.75 },
    colors: BRAND_COLORS,
    disableForReducedMotion: true,
  });
}
