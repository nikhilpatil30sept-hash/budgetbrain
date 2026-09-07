import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
  zodFieldErrors,
} from "../schemas.js";
import { requireAuth, SESSION_COOKIE } from "../middleware/auth.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import {
  consumePasswordResetToken,
  createPasswordResetToken,
  createSession,
  createUser,
  deleteSession,
  findUserByEmail,
  findUserById,
  setPassword,
  verifyCredentials,
} from "../services/auth.js";
import { sendPasswordResetEmail } from "../services/mailer.js";
import { SESSION_TTL_MS } from "../lib/auth.js";

export const authRouter = Router();

// Auth endpoints are a favorite brute-force target, so they get a much
// tighter limit than the general rate limit applied to the rest of the API
// (see the environment-gated limiter in app.ts). A tight ceiling in
// production, but a much more generous one everywhere else — local dev and
// the e2e suite both log in far more than 20 times per 15 minutes just by
// existing (every spec logs in at least once, some retry, and every browser
// project added multiplies that further), and none of that has anything to
// do with the abuse this limit exists to stop.
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: process.env.NODE_ENV === "production" ? 20 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
});
authRouter.use(authLimiter);

function setSessionCookie(res: import("express").Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

authRouter.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", fields: zodFieldErrors(parsed.error) });
    }
    const { email, password } = parsed.data;

    if (await findUserByEmail(email)) {
      return res.status(409).json({ error: "An account with that email already exists" });
    }

    const user = await createUser(email, password);
    const { token } = await createSession(user.id);
    setSessionCookie(res, token);
    res.status(201).json({ id: user.id, email: user.email });
  })
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", fields: zodFieldErrors(parsed.error) });
    }
    const { email, password } = parsed.data;

    const user = await verifyCredentials(email, password);
    if (!user) {
      // Deliberately vague — never reveal whether the email exists.
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const { token } = await createSession(user.id);
    setSessionCookie(res, token);
    res.json({ id: user.id, email: user.email });
  })
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await deleteSession(token);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.status(204).end();
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await findUserById(req.userId!);
    if (!user) return res.status(401).json({ error: "Not logged in" });
    res.json({ id: user.id, email: user.email });
  })
);

authRouter.post(
  "/forgot-password",
  asyncHandler(async (req, res) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", fields: zodFieldErrors(parsed.error) });
    }
    const { email } = parsed.data;

    // Same response whether or not the account exists, so a stranger can't
    // use this form to find out which emails have accounts.
    const genericResponse = {
      message: "If an account exists for that email, a reset link has been sent.",
    };

    const user = await findUserByEmail(email);
    if (!user) return res.json(genericResponse);

    const token = await createPasswordResetToken(user.id);
    try {
      await sendPasswordResetEmail(user.email, token);
    } catch (err) {
      console.error(err);
      return res.status(502).json({ error: "Could not send the reset email. Please try again shortly." });
    }
    res.json(genericResponse);
  })
);

authRouter.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", fields: zodFieldErrors(parsed.error) });
    }
    const { token, password } = parsed.data;

    const userId = await consumePasswordResetToken(token);
    if (!userId) {
      return res.status(400).json({ error: "This reset link is invalid or has expired." });
    }

    await setPassword(userId, password);
    // Log them straight back in so resetting a password doesn't dead-end at
    // a second login screen.
    const { token: sessionToken } = await createSession(userId);
    setSessionCookie(res, sessionToken);
    const user = (await findUserById(userId))!;
    res.json({ id: user.id, email: user.email });
  })
);
