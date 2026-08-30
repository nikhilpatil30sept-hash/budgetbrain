import { Router } from "express";
import { db } from "../db.js";
import { addDaysISO, nowISO, todayISO } from "../lib/dates.js";
import { goalCreateSchema, goalPatchSchema, zodFieldErrors } from "../schemas.js";

export const goalsRouter = Router();

interface GoalRow {
  id: number;
  name: string;
  target_cents: number;
  deadline: string;
  created_at: string;
}

/**
 * Spending velocity: average weekly net savings (income minus expenses,
 * Transfers excluded) over the trailing 8 weeks.
 */
function weeklyVelocityCents(userId: number): number {
  const today = todayISO();
  const start = addDaysISO(today, -56);
  const { net } = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS net
       FROM transactions
       WHERE date > ? AND date <= ? AND category != 'Transfers' AND user_id = ?`
    )
    .get(start, today, userId) as { net: number };
  return Math.round(net / 8);
}

/**
 * Progress model (assumption, noted in README): money "saved toward" a goal
 * is the cumulative net savings since the goal was created, clamped to
 * [0, target]. The goals table intentionally has no saved_cents column in v1.
 */
function goalStats(goal: GoalRow, velocity: number, userId: number) {
  const today = todayISO();
  const createdDate = goal.created_at.slice(0, 10);
  const { net } = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS net
       FROM transactions
       WHERE date >= ? AND category != 'Transfers' AND user_id = ?`
    )
    .get(createdDate, userId) as { net: number };
  const saved_cents = Math.min(Math.max(net, 0), goal.target_cents);
  const remaining_cents = goal.target_cents - saved_cents;

  const msPerWeek = 7 * 24 * 3600 * 1000;
  const weeksLeft =
    (new Date(`${goal.deadline}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) /
    msPerWeek;

  const required_weekly_cents =
    remaining_cents <= 0 ? 0 : weeksLeft > 0 ? Math.ceil(remaining_cents / weeksLeft) : null;

  let projected_completion: string | null = null;
  if (remaining_cents <= 0) {
    projected_completion = today;
  } else if (velocity > 0) {
    projected_completion = addDaysISO(today, Math.ceil((remaining_cents / velocity) * 7));
  }

  const status: "done" | "on_track" | "behind" | "not_reachable" =
    remaining_cents <= 0
      ? "done"
      : velocity <= 0
        ? "not_reachable"
        : required_weekly_cents !== null && velocity >= required_weekly_cents
          ? "on_track"
          : "behind";

  return {
    ...goal,
    saved_cents,
    remaining_cents,
    weeks_left: Math.max(0, Math.round(weeksLeft * 10) / 10),
    required_weekly_cents,
    velocity_weekly_cents: velocity,
    projected_completion,
    status,
  };
}

goalsRouter.get("/", (req, res) => {
  const goals = db
    .prepare("SELECT * FROM goals WHERE user_id = ? ORDER BY deadline ASC")
    .all(req.userId) as GoalRow[];
  const velocity = weeklyVelocityCents(req.userId!);
  res.json({
    velocity_weekly_cents: velocity,
    goals: goals.map((g) => goalStats(g, velocity, req.userId!)),
  });
});

goalsRouter.post("/", (req, res) => {
  const parsed = goalCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", fields: zodFieldErrors(parsed.error) });
  }
  const { name, target_cents, deadline } = parsed.data;
  const info = db
    .prepare("INSERT INTO goals (name, target_cents, deadline, created_at, user_id) VALUES (?, ?, ?, ?, ?)")
    .run(name, target_cents, deadline, nowISO(), req.userId);
  const goal = db
    .prepare("SELECT * FROM goals WHERE id = ? AND user_id = ?")
    .get(info.lastInsertRowid, req.userId) as GoalRow;
  res.status(201).json(goalStats(goal, weeklyVelocityCents(req.userId!), req.userId!));
});

goalsRouter.patch("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
  const existing = db.prepare("SELECT * FROM goals WHERE id = ? AND user_id = ?").get(id, req.userId);
  if (!existing) return res.status(404).json({ error: "Goal not found" });

  const parsed = goalPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", fields: zodFieldErrors(parsed.error) });
  }
  const sets: string[] = [];
  const params: Record<string, unknown> = { id, userId: req.userId };
  for (const field of ["name", "target_cents", "deadline"] as const) {
    if (parsed.data[field] !== undefined) {
      sets.push(`${field} = @${field}`);
      params[field] = parsed.data[field];
    }
  }
  db.prepare(`UPDATE goals SET ${sets.join(", ")} WHERE id = @id AND user_id = @userId`).run(params);
  const goal = db
    .prepare("SELECT * FROM goals WHERE id = ? AND user_id = ?")
    .get(id, req.userId) as GoalRow;
  res.json(goalStats(goal, weeklyVelocityCents(req.userId!), req.userId!));
});

goalsRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
  const info = db.prepare("DELETE FROM goals WHERE id = ? AND user_id = ?").run(id, req.userId);
  if (info.changes === 0) return res.status(404).json({ error: "Goal not found" });
  res.status(204).end();
});
