import type { NextFunction, Request, Response } from "express";
import { getUserIdForSession } from "../services/auth.js";

export const SESSION_COOKIE = "sid";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

/** Every route mounted behind this must have a logged-in user. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  const userId = token ? getUserIdForSession(token) : null;
  if (!userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  req.userId = userId;
  next();
}
