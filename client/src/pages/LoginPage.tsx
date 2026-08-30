import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { api, ApiError } from "../lib/api";
import type { User } from "../lib/types";
import { AuthLayout } from "../components/AuthLayout";
import { useToast } from "../components/Toast";

export function LoginPage({
  onLoggedIn,
  onGoToSignup,
  onGoToForgot,
}: {
  onLoggedIn: (user: User) => void;
  onGoToSignup: () => void;
  onGoToForgot: () => void;
}) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await api.post<User>("/api/auth/login", { email: email.trim(), password });
      toast("success", "Welcome back! 👋");
      onLoggedIn(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't log in. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <h2 className="text-lg font-extrabold text-ink-900">👋 Welcome back</h2>
      <p className="mt-1 text-sm font-medium text-ink-600">Log in to see your budget.</p>
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
        <label className="block text-sm">
          <span className="font-extrabold text-ink-900">Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field mt-1 block w-full"
          />
        </label>
        {error && <p className="text-sm font-semibold text-brand-600">{error}</p>}
        <motion.button whileTap={{ scale: 0.95 }} type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? "Logging in…" : "Log in"}
        </motion.button>
      </form>
      <div className="mt-4 flex items-center justify-between text-sm font-semibold">
        <button type="button" onClick={onGoToForgot} className="text-ink-500 hover:text-brand-600">
          Forgot password?
        </button>
        <button type="button" onClick={onGoToSignup} className="text-brand-600 hover:text-brand-700">
          Create an account
        </button>
      </div>
    </AuthLayout>
  );
}
