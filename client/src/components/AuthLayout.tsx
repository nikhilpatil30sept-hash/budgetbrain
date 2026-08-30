import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Backdrop } from "./Backdrop";
import { Card } from "./Bits";

/**
 * Shared frame for the login/signup/forgot/reset screens — same logo
 * treatment as the app header, so the auth flow feels like part of the
 * same product rather than a bolted-on gate.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <Backdrop />
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 flex items-center justify-center gap-2.5 text-xl font-extrabold tracking-tight text-ink-900"
      >
        <span
          className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-2xl shadow-soft"
          aria-hidden
        >
          🧠
        </span>
        <span>
          Budget<span className="text-brand-500">Brain</span>
        </span>
      </motion.div>
      <Card className="w-full">{children}</Card>
    </div>
  );
}
