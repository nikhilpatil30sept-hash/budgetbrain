import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ImportPage } from "../ImportPage";

const { apiPost, toastSpy } = vi.hoisted(() => ({
  apiPost: vi.fn(),
  toastSpy: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  api: { post: apiPost },
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
  celebrate: vi.fn(),
  sprinkle: vi.fn(),
}));

beforeEach(() => {
  apiPost.mockReset();
  toastSpy.mockReset();
});

afterEach(cleanup);

function pasteCsv(text: string) {
  const textarea = screen.getByPlaceholderText(/Date,Description,Amount/);
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.blur(textarea);
}

describe("ImportPage — CSV mapping and preview", () => {
  test("auto-detects columns and shows a mapped preview for a valid CSV", () => {
    render(<ImportPage onImported={vi.fn()} />);

    pasteCsv("Date,Description,Amount\n2026-01-05,Coffee Shop,-4.50\n2026-01-06,Paycheck,1000.00");

    expect(screen.getByText("🗺️ Map the columns")).toBeInTheDocument();
    expect(screen.getByText(/2 data rows found/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "🚀 Import 2 rows" })).toBeInTheDocument();
  });

  test("shows an error toast for a CSV that doesn't look like one", () => {
    render(<ImportPage onImported={vi.fn()} />);

    pasteCsv("OnlyOneColumn\nrow1\nrow2");

    expect(toastSpy).toHaveBeenCalledWith(
      "error",
      expect.stringContaining("doesn't look like a CSV")
    );
    expect(screen.queryByText("🗺️ Map the columns")).not.toBeInTheDocument();
  });
});

describe("ImportPage — row-count cap", () => {
  test("warns instead of importing when a file exceeds 1,000 rows", () => {
    render(<ImportPage onImported={vi.fn()} />);

    const header = "Date,Description,Amount";
    const rows = Array.from(
      { length: 1001 },
      (_, i) => `2026-01-01,Row ${i},-1.00`
    );
    pasteCsv([header, ...rows].join("\n"));

    const importButton = screen.getByRole("button", { name: "🚀 Import 1001 rows" });
    fireEvent.click(importButton);

    expect(toastSpy).toHaveBeenCalledWith("error", expect.stringContaining("capped at 1000"));
    expect(apiPost).not.toHaveBeenCalled();
  });
});

describe("ImportPage — successful import", () => {
  test("shows the celebration summary after a successful import", async () => {
    apiPost.mockResolvedValueOnce({ imported: 2, skipped: [], duplicates: [] });

    render(<ImportPage onImported={vi.fn()} />);
    pasteCsv("Date,Description,Amount\n2026-01-05,Coffee Shop,-4.50\n2026-01-06,Paycheck,1000.00");

    fireEvent.click(screen.getByRole("button", { name: "🚀 Import 2 rows" }));

    expect(await screen.findByText("Woohoo — 2 transactions in!")).toBeInTheDocument();
    expect(screen.getByText("2 imported · 0 skipped")).toBeInTheDocument();
  });

  test("reports server-side skips and duplicates in the summary", async () => {
    apiPost.mockResolvedValueOnce({
      imported: 1,
      skipped: [{ row: 2, reason: "invalid category" }],
      duplicates: [{ row: 1, description: "Coffee Shop" }],
    });

    render(<ImportPage onImported={vi.fn()} />);
    pasteCsv("Date,Description,Amount\n2026-01-05,Coffee Shop,-4.50\n2026-01-06,Paycheck,1000.00");

    fireEvent.click(screen.getByRole("button", { name: "🚀 Import 2 rows" }));

    expect(await screen.findByText("Woohoo — 1 transaction in!")).toBeInTheDocument();
    expect(screen.getByText("1 imported · 1 skipped")).toBeInTheDocument();
    expect(screen.getByText(/possible/)).toBeInTheDocument();
    expect(screen.getByText(/invalid category \(server\)/)).toBeInTheDocument();
  });
});
