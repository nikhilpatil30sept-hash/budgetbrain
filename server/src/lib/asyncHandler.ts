import type { NextFunction, Request, Response } from "express";

/**
 * Express 4 does not forward a rejected promise from an async handler to
 * the error-handling middleware on its own — an unhandled rejection there
 * just hangs the request. Wrap every async route handler and middleware
 * function in this so errors reach the app's JSON error handler instead.
 */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
