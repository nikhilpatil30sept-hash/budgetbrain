import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { api, ApiError } from "../lib/api";
import type { User } from "../lib/types";
import { AuthLayout } from "../components/AuthLayout";
import { useToast } from "../components/Toast";

export function SignupPage({
  onSignedUp,
  onGoToLogin,
}: {
  onSignedUp: (user: User) => void;
  onGoToLogin: () => void;
}) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setSubmitting(true);
    try {
      const user = await api.post<User>("/api/auth/signup", { email: email.trim(), password });
      toast("success", "Account created — welcome to BudgetBrain! 🎉");
      onSignedUp(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create your account. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <h2 className="text-lg font-extrabold text-ink-900">🌱 Create your account</h2>
      <p className="mt-1 text-sm font-medium text-ink-600">Your own private budget, just for you.</p>
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
          <span className="font-extrabold text-ink-900">Password</span>{" "}
          <span className="ml-2 text-xs font-medium text-ink-400">at least 8 characters</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field mt-1 block w-full"
          />
        </label>
        <label className="block text-sm">
          <span className="font-extrabold text-ink-900">Confirm password</span>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="field mt-1 block w-full"
          />
        </label>
        {error && <p className="text-sm font-semibold text-brand-600">{error}</p>}
        <motion.button whileTap={{ scale: 0.95 }} type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? "Creating account…" : "Create account"}
        </motion.button>
      </form>
      <p className="mt-4 text-center text-sm font-semibold">
        Already have an account?{" "}
        <button type="button" onClick={onGoToLogin} className="text-brand-600 hover:text-brand-700">
          Log in
        </button>
      </p>
    </AuthLayout>
  );
}
