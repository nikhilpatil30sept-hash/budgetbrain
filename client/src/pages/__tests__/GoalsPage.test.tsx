import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GoalsPage } from "../GoalsPage";
import type { Goal } from "../../lib/types";

const { apiGet, apiPost, apiDel, toastSpy } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDel: vi.fn(),
  toastSpy: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  api: { get: apiGet, post: apiPost, del: apiDel },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status = 0) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("../../components/Toast", () => ({
  useToast: () => toastSpy,
}));

vi.mock("../../lib/confetti", () => ({
  sprinkle: vi.fn(),
  celebrate: vi.fn(),
}));

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 1,
    name: "Trip to Tokyo",
    target_cents: 10000,
    deadline: "2026-06-01",
    created_at: "2026-01-01T00:00:00.000Z",
    saved_cents: 6200,
    remaining_cents: 3800,
    weeks_left: 4,
    required_weekly_cents: 950,
    velocity_weekly_cents: 1000,
    projected_completion: "2026-03-01",
    status: "on_track",
    ...overrides,
  };
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiDel.mockReset();
  toastSpy.mockReset();
});

afterEach(cleanup);

describe("GoalsPage — creation form", () => {
  test("renders the form and an empty state when there are no goals", async () => {
    apiGet.mockResolvedValue({ velocity_weekly_cents: 0, goals: [] });

    const { container } = render(<GoalsPage symbol="$" />);

    expect(await screen.findByText("What are you saving for?")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Goal name/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Target/)).toBeInTheDocument();
    expect(container.querySelector('input[type="date"]')).toBeInTheDocument();
  });

  test("submitting the form posts the right payload and reloads the list", async () => {
    const user = userEvent.setup();
    apiGet.mockResolvedValue({ velocity_weekly_cents: 0, goals: [] });
    apiPost.mockResolvedValueOnce({});

    const { container } = render(<GoalsPage symbol="$" />);
    await screen.findByText("What are you saving for?");

    await user.type(screen.getByPlaceholderText(/Goal name/), "Emergency fund");
    await user.type(screen.getByPlaceholderText(/Target/), "500");
    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-12-31" } });

    await user.click(screen.getByRole("button", { name: "Add goal" }));

    expect(apiPost).toHaveBeenCalledWith("/api/goals", {
      name: "Emergency fund",
      target_cents: 50000,
      deadline: "2026-12-31",
    });
    expect(toastSpy).toHaveBeenCalledWith("success", expect.stringContaining("New goal on the board"));
    // load() runs once on mount and again after a successful create.
    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  test("shows a validation toast and does not submit when the name is empty", async () => {
    const user = userEvent.setup();
    apiGet.mockResolvedValue({ velocity_weekly_cents: 0, goals: [] });

    const { container } = render(<GoalsPage symbol="$" />);
    await screen.findByText("What are you saving for?");

    await user.type(screen.getByPlaceholderText(/Target/), "500");
    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-12-31" } });
    await user.click(screen.getByRole("button", { name: "Add goal" }));

    expect(toastSpy).toHaveBeenCalledWith("error", expect.stringContaining("Give the goal a name"));
    expect(apiPost).not.toHaveBeenCalled();
  });

  test("shows a validation toast when the target amount is invalid", async () => {
    const user = userEvent.setup();
    apiGet.mockResolvedValue({ velocity_weekly_cents: 0, goals: [] });

    const { container } = render(<GoalsPage symbol="$" />);
    await screen.findByText("What are you saving for?");

    await user.type(screen.getByPlaceholderText(/Goal name/), "New couch");
    await user.type(screen.getByPlaceholderText(/Target/), "not-a-number");
    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-12-31" } });
    await user.click(screen.getByRole("button", { name: "Add goal" }));

    expect(toastSpy).toHaveBeenCalledWith("error", expect.stringContaining("positive amount"));
    expect(apiPost).not.toHaveBeenCalled();
  });
});

describe("GoalsPage — progress bar rendering", () => {
  test("renders the saved percentage, status badge, and pace figures for a goal", async () => {
    apiGet.mockResolvedValueOnce({
      velocity_weekly_cents: 1000,
      goals: [makeGoal()],
    });

    render(<GoalsPage symbol="$" />);

    expect(await screen.findByText("Trip to Tokyo")).toBeInTheDocument();
    expect(screen.getByText("62%")).toBeInTheDocument(); // round(6200/10000*100)
    expect(screen.getByText("🚀 On track")).toBeInTheDocument();
    expect(screen.getByText("$62.00")).toBeInTheDocument(); // saved amount
    expect(screen.getByText("$9.50/wk")).toBeInTheDocument(); // required_weekly_cents
    expect(screen.getByText("$10.00/wk")).toBeInTheDocument(); // velocity_weekly_cents
    expect(screen.getByText("2026-03-01")).toBeInTheDocument(); // projected_completion
  });

  test("shows a placeholder for required pace once the deadline has passed", async () => {
    apiGet.mockResolvedValueOnce({
      velocity_weekly_cents: 0,
      goals: [makeGoal({ required_weekly_cents: null, status: "not_reachable", projected_completion: null })],
    });

    render(<GoalsPage symbol="$" />);

    expect(await screen.findByText("Trip to Tokyo")).toBeInTheDocument();
    expect(screen.getByText("— (past deadline)")).toBeInTheDocument();
    expect(screen.getByText("🧗 Needs a bigger push")).toBeInTheDocument();
    expect(screen.getByText("not at this pace 😅")).toBeInTheDocument();
  });
});
