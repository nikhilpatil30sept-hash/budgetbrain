import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
}

const ToastContext = createContext<(kind: Toast["kind"], message: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

const META: Record<Toast["kind"], { icon: string; cls: string }> = {
  success: { icon: "🎉", cls: "border-grow-500 bg-grow-50 text-grow-700" },
  error: { icon: "😬", cls: "border-brand-500 bg-brand-50 text-brand-700" },
  info: { icon: "💡", cls: "border-spark-500 bg-spark-100 text-spark-600" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((kind: Toast["kind"], message: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 80, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 380, damping: 28 }}
              role="status"
              className={`flex items-start gap-2 rounded-2xl border-2 px-4 py-3 text-sm font-bold shadow-lift ${META[t.kind].cls}`}
            >
              <span className="text-base" aria-hidden>
                {META[t.kind].icon}
              </span>
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
