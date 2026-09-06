import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CategorizePanel } from "../CategorizePanel";
import type { RunStatus } from "../../lib/types";

// Hoisted so these are safely referenceable inside the vi.mock factories
// below (vi.mock calls are hoisted above regular imports/consts).
const { apiGet, apiPost, toastSpy } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  toastSpy: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  api: { get: apiGet, post: apiPost },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status = 0) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("../Toast", () => ({
  useToast: () => toastSpy,
}));

vi.mock("../../lib/confetti", () => ({
  sprinkle: vi.fn(),
  celebrate: vi.fn(),
}));

function idleStatus(): RunStatus {
  return {
    run_id: null,
    status: "idle",
    total_transactions: 0,
    cached_count: 0,
    ai_count: 0,
    fallback_count: 0,
    batches_total: 0,
    batches_done: 0,
    batches_skipped: 0,
    errors: [],
    started_at: null,
    finished_at: null,
  };
}

function runningStatus(overrides: Partial<RunStatus> = {}): RunStatus {
  return {
    run_id: "run-1",
    status: "running",
    total_transactions: 10,
    cached_count: 0,
    ai_count: 0,
    fallback_count: 0,
    batches_total: 2,
    batches_done: 0,
    batches_skipped: 0,
    errors: [],
    started_at: new Date().toISOString(),
    finished_at: null,
    ...overrides,
  };
}

function doneStatus(overrides: Partial<RunStatus> = {}): RunStatus {
  return {
    run_id: "run-1",
    status: "done",
    total_transactions: 10,
    cached_count: 0,
    ai_count: 10,
    fallback_count: 0,
    batches_total: 2,
    batches_done: 2,
    batches_skipped: 0,
    errors: [],
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  toastSpy.mockReset();
});

afterEach(cleanup);

describe("CategorizePanel", () => {
  test("shows the idle button when nothing is running", async () => {
    apiGet.mockResolvedValueOnce(idleStatus()); // initial mount poll

    render(<CategorizePanel uncategorizedHint={5} onFinished={vi.fn()} />);

    expect(await screen.findByRole("button", { name: "✨ Auto-label" })).toBeEnabled();
  });

  test("disables the button when there is nothing left to categorize", async () => {
    apiGet.mockResolvedValueOnce(idleStatus());

    render(<CategorizePanel uncategorizedHint={0} onFinished={vi.fn()} />);

    expect(await screen.findByRole("button", { name: "✨ Auto-label" })).toBeDisabled();
  });

  test(
    "shows batch progress while running, then reports completion",
    async () => {
      const onFinished = vi.fn();
      apiGet.mockResolvedValueOnce(idleStatus()); // initial mount poll
      apiPost.mockResolvedValueOnce(undefined); // POST /api/categorize
      apiGet.mockResolvedValueOnce(runningStatus({ batches_done: 0 })); // status right after start()
      apiGet.mockResolvedValueOnce(runningStatus({ batches_done: 1 })); // first 1s poll tick
      apiGet.mockResolvedValueOnce(doneStatus()); // second 1s poll tick

      render(<CategorizePanel uncategorizedHint={10} onFinished={onFinished} />);

      const button = await screen.findByRole("button", { name: "✨ Auto-label" });
      fireEvent.click(button);

      expect(await screen.findByText("Batch 1 of 2…")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Sorting the pile…" })).toBeDisabled();

      expect(await screen.findByText("Batch 2 of 2…", {}, { timeout: 3000 })).toBeInTheDocument();

      const finishedButton = await screen.findByRole(
        "button",
        { name: "✨ Auto-label" },
        { timeout: 3000 }
      );
      expect(finishedButton).toBeInTheDocument();
      expect(onFinished).toHaveBeenCalledTimes(1);
      expect(toastSpy).toHaveBeenCalledWith("success", expect.stringContaining("Sorted 10 transactions"));
    },
    10000
  );

  test(
    "surfaces an error toast when the run finishes with errors",
    async () => {
      const onFinished = vi.fn();
      apiGet.mockResolvedValueOnce(idleStatus());
      apiPost.mockResolvedValueOnce(undefined);
      apiGet.mockResolvedValueOnce(runningStatus());
      apiGet.mockResolvedValueOnce(doneStatus({ errors: ["Gemini rate limit hit"] }));

      render(<CategorizePanel uncategorizedHint={10} onFinished={onFinished} />);

      const button = await screen.findByRole("button", { name: "✨ Auto-label" });
      fireEvent.click(button);

      // "✨ Auto-label" is also what the button reads before a run starts, so
      // confirm it actually entered the running state first — otherwise the
      // wait below could resolve on that pre-start moment instead of on
      // genuine completion.
      await screen.findByRole("button", { name: "Sorting the pile…" });
      await screen.findByRole("button", { name: "✨ Auto-label" }, { timeout: 3000 });

      expect(toastSpy).toHaveBeenCalledWith("error", "Gemini rate limit hit");
      expect(onFinished).toHaveBeenCalledTimes(1);
    },
    10000
  );
});
