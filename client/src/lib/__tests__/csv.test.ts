import { describe, test, expect } from "vitest";
import { parseAmountCell, parseDateCell } from "../csv";

describe("parseAmountCell", () => {
  test("converts a plain amount like 19.99 to 1999 cents", () => {
    expect(parseAmountCell("19.99")).toEqual({ cents: 1999 });
  });

  test("parses a leading minus sign as a negative amount", () => {
    expect(parseAmountCell("-19.99")).toEqual({ cents: -1999 });
  });

  test("parses accounting-style parentheses as a negative amount", () => {
    expect(parseAmountCell("(19.99)")).toEqual({ cents: -1999 });
  });

  test("rejects more than 2 decimal places instead of rounding", () => {
    const result = parseAmountCell("10.005");
    expect(result.cents).toBeUndefined();
    expect(result.error).toMatch(/more than 2 decimal places/);
  });

  test("rejects an empty cell", () => {
    const result = parseAmountCell("");
    expect(result.cents).toBeUndefined();
    expect(result.error).toBeDefined();
  });
});

describe("parseDateCell", () => {
  test("parses an ISO date straight through", () => {
    expect(parseDateCell("2026-06-01", "auto")).toEqual({ iso: "2026-06-01" });
  });

  test("rejects an impossible date like Feb 30 instead of rolling over into March", () => {
    const result = parseDateCell("2026-02-30", "auto");
    expect(result.iso).toBeUndefined();
    expect(result.error).toMatch(/invalid date/);
  });

  test("resolves an unambiguous day-first date without needing a format choice", () => {
    // 25 can't be a month, so this can only mean 25 December 2025.
    expect(parseDateCell("25/12/2025", "auto")).toEqual({ iso: "2025-12-25" });
  });

  test("demands a format choice for a genuinely ambiguous date", () => {
    const result = parseDateCell("03/04/2025", "auto");
    expect(result.iso).toBeUndefined();
    expect(result.error).toMatch(/ambiguous/);
  });

  test("resolves that same ambiguous date once a format is supplied", () => {
    expect(parseDateCell("03/04/2025", "MDY")).toEqual({ iso: "2025-03-04" });
  });

  test("parses the 'Mon DD, YYYY' text format", () => {
    expect(parseDateCell("Jun 1, 2026", "auto")).toEqual({ iso: "2026-06-01" });
  });
});
