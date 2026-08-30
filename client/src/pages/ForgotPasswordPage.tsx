import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { api, ApiError } from "../lib/api";
import { AuthLayout } from "../components/AuthLayout";

export function ForgotPasswordPage({ onGoToLogin }: { onGoToLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post<{ message: string }>("/api/auth/forgot-password", { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <AuthLayout>
        <h2 className="text-lg font-extrabold text-ink-900">📬 Check your email</h2>
        <p className="mt-2 text-sm font-medium text-ink-600">
          If an account exists for <span className="font-bold text-ink-900">{email.trim()}</span>, a reset link is
          on its way. It's valid for 1 hour.
        </p>
        <button type="button" onClick={onGoToLogin} className="btn-ghost mt-4">
          Back to log in
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h2 className="text-lg font-extrabold text-ink-900">🔑 Forgot your password?</h2>
      <p className="mt-1 text-sm font-medium text-ink-600">
        Enter your email and we'll send you a link to reset it.
      </p>
      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <label className="block text-sm">
          <span className="font-extrabold text-ink-900">Email</span>
          <input
            type="email"
            required
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field mt-1 block w-full"
          />
        </label>
        {error && <p className="text-sm font-semibold text-brand-600">{error}</p>}
        <motion.button whileTap={{ scale: 0.95 }} type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? "Sending…" : "Send reset link"}
        </motion.button>
      </form>
      <p className="mt-4 text-center text-sm font-semibold">
        <button type="button" onClick={onGoToLogin} className="text-brand-600 hover:text-brand-700">
          Back to log in
        </button>
      </p>
    </AuthLayout>
  );
}
