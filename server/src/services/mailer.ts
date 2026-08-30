import { Resend } from "resend";

// Same tolerant-missing-key pattern as services/gemini.ts: the app works
// fully without a mail key, it just can't send a real email yet. Until a
// key is configured, the reset link is printed to the server console
// instead, so signup/login/reset-password can all be built and tested
// before you set up a mail provider.
export function hasMailKey(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

const FROM_ADDRESS = process.env.MAIL_FROM ?? "BudgetBrain <onboarding@resend.dev>";
// Where the reset link should point. Update this once the app has a real
// public URL; for now it defaults to the local dev client.
const APP_URL = process.env.APP_URL ?? "http://localhost:5173";

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const resetLink = `${APP_URL}/?reset_token=${token}`;

  if (!hasMailKey()) {
    console.warn(
      `⚠ RESEND_API_KEY not set — no email was actually sent. Reset link for ${email}:\n  ${resetLink}`
    );
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: "Reset your BudgetBrain password",
    html: `
      <p>Someone (hopefully you) asked to reset the password on your BudgetBrain account.</p>
      <p><a href="${resetLink}">Click here to choose a new password</a>. This link works for 1 hour.</p>
      <p>If you didn't ask for this, you can safely ignore this email.</p>
    `,
  });

  if (error) {
    console.error("Failed to send password reset email:", error);
    throw new Error("Could not send the reset email. Please try again shortly.");
  }
}
