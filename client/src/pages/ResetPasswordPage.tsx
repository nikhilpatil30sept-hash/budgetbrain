import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { api, ApiError } from "../lib/api";
import type { User } from "../lib/types";
import { AuthLayout } from "../components/AuthLayout";
import { useToast } from "../components/Toast";

export function ResetPasswordPage({
  token,
  onReset,
  onGoToLogin,
}: {
  token: string;
  onReset: (user: User) => void;
  onGoToLogin: () => void;
}) {
  const toast = useToast();
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
      const user = await api.post<User>("/api/auth/reset-password", { token, password });
      toast("success", "Password updated — you're logged in 🎉");
      onReset(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "This reset link is invalid or has expired.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <h2 className="text-lg font-extrabold text-ink-900">🔒 Choose a new password</h2>
      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <label className="block text-sm">
          <span className="font-extrabold text-ink-900">New password</span>{" "}
          <span className="ml-2 text-xs font-medium text-ink-400">at least 8 characters</span>
          <input
            type="password"
            required
            minLength={8}
            autoFocus
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field mt-1 block w-full"
          />
        </label>
        <label className="block text-sm">
          <span className="font-extrabold text-ink-900">Confirm new password</span>
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
          {submitting ? "Saving…" : "Reset password"}
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
