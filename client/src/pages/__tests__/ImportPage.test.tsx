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

/**
 * Regression coverage for the yearless-date defect and the two problems it
 * exposed: the app blamed the column mapping for every failed import, and it
 * let an all-positive card statement import silently as income.
 */
describe("ImportPage — statements with yearless dates", () => {
  const STATEMENT = [
    "REF.#,TRANS. DATE,POST DATE,DETAILS,AMOUNT($)",
    "010,Jul 22,Jul 23,TIM HORTONS #1417 519-649-1733 ON,$10.03",
    "011,Jul 23,Jul 23,TIM HORTONS #0035 519-870-4218 ON,$1.92",
  ].join("\n");

  test("asks for a statement year when the dates don't carry one", () => {
    render(<ImportPage onImported={vi.fn()} />);
    pasteCsv(STATEMENT);

    expect(screen.getByLabelText("Statement year")).toBeInTheDocument();
    expect(screen.getByText(/these dates have no year/)).toBeInTheDocument();
  });

  test("does not ask for a year when the dates already carry one", () => {
    render(<ImportPage onImported={vi.fn()} />);
    pasteCsv("Date,Description,Amount\n2026-01-05,Coffee Shop,-4.50");

    expect(screen.queryByLabelText("Statement year")).not.toBeInTheDocument();
  });

  test("refuses to import — with a specific reason — if the year is cleared", () => {
    render(<ImportPage onImported={vi.fn()} />);
    pasteCsv(STATEMENT);

    fireEvent.change(screen.getByLabelText("Statement year"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Import 2 rows/ }));

    expect(apiPost).not.toHaveBeenCalled();
    // The old message pointed at the column mapping, which was never wrong.
    expect(toastSpy).toHaveBeenCalledWith("error", expect.stringContaining("no year"));
    expect(toastSpy).not.toHaveBeenCalledWith("error", expect.stringContaining("column mapping"));
  });

  test("imports the rows once a statement year is chosen", async () => {
    apiPost.mockResolvedValue({ imported: 2, skipped: [], duplicates: [] });
    render(<ImportPage onImported={vi.fn()} />);
    pasteCsv(STATEMENT);

    fireEvent.change(screen.getByLabelText("Statement year"), { target: { value: "2026" } });
    fireEvent.click(screen.getByRole("button", { name: /Import 2 rows/ }));

    expect(await screen.findByText("Woohoo — 2 transactions in!")).toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledTimes(1);
    const sent = apiPost.mock.calls[0][1] as { rows: { date: string }[] };
    // Asserts the chosen year reached every row, without coupling the test to
    // which of the file's two date columns auto-detection happened to pick.
    expect(sent.rows).toHaveLength(2);
    expect(sent.rows.every((r) => /^2026-07-\d{2}$/.test(r.date))).toBe(true);
  });

  test("warns that an all-positive statement would import as income", () => {
    render(<ImportPage onImported={vi.fn()} />);
    pasteCsv(STATEMENT);

    expect(screen.getByText(/Every amount in this file is positive/)).toBeInTheDocument();
  });

  test("the income warning disappears once the flip-the-sign box is ticked", () => {
    render(<ImportPage onImported={vi.fn()} />);
    pasteCsv(STATEMENT);

    fireEvent.click(screen.getByLabelText(/Expenses are positive numbers/));

    expect(screen.queryByText(/Every amount in this file is positive/)).not.toBeInTheDocument();
  });

  test("no income warning for a file that already has negative amounts", () => {
    render(<ImportPage onImported={vi.fn()} />);
    pasteCsv("Date,Description,Amount\n2026-01-05,Coffee Shop,-4.50\n2026-01-06,Paycheck,1000.00");

    expect(screen.queryByText(/Every amount in this file is positive/)).not.toBeInTheDocument();
  });
});

describe("ImportPage — skip reasons", () => {
  test("reports the actual reason rows were skipped, not the column mapping", () => {
    render(<ImportPage onImported={vi.fn()} />);
    pasteCsv("Date,Description,Amount\n2026-01-05,Coffee,not-a-number\n2026-01-06,Tea,also-not");

    fireEvent.click(screen.getByRole("button", { name: /Import 2 rows/ }));

    expect(apiPost).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      "error",
      expect.stringContaining("unparseable amount")
    );
  });

  test("groups rows failing for the same reason on different values into one count", () => {
    render(<ImportPage onImported={vi.fn()} />);
    pasteCsv("Date,Description,Amount\n2026-01-05,Coffee,bad-one\n2026-01-06,Tea,bad-two");

    fireEvent.click(screen.getByRole("button", { name: /Import 2 rows/ }));

    // Two distinct bad values, one shared reason — so "all 2 rows", not
    // two separate reasons reported as if they were unrelated.
    expect(toastSpy).toHaveBeenCalledWith("error", expect.stringContaining("all 2 rows were skipped"));
  });
});
