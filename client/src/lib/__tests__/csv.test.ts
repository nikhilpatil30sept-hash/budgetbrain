import { describe, test, expect } from "vitest";
import {
  needsStatementYear,
  parseAmountCell,
  parseDateCell,
  suggestStatementYear,
} from "../csv";

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

/**
 * Regression coverage for a real defect: a credit-card statement exported as
 * CSV dates its rows "Jul 23" — the year appears once in the statement header,
 * never on the rows. Every one of those rows was rejected as an unsupported
 * format, so a genuine bank export could not be imported at all.
 */
describe("parseDateCell — yearless statement dates", () => {
  test('refuses "Jul 23" when no statement year is supplied, and says so specifically', () => {
    const result = parseDateCell("Jul 23", "auto");
    expect(result.iso).toBeUndefined();
    // The old message said "unsupported date format", which read as "this
    // shape is wrong". It isn't — only the year is missing, and saying which
    // is the difference between a fixable error and a dead end.
    expect(result.error).toMatch(/no year/);
  });

  test('parses "Jul 23" once a statement year is given', () => {
    expect(parseDateCell("Jul 23", "auto", 2026)).toEqual({ iso: "2026-07-23" });
  });

  test("accepts the abbreviated-with-a-dot and full month spellings", () => {
    expect(parseDateCell("Jul. 23", "auto", 2026)).toEqual({ iso: "2026-07-23" });
    expect(parseDateCell("July 23", "auto", 2026)).toEqual({ iso: "2026-07-23" });
  });

  test('parses the day-first "23 Jul" spelling too', () => {
    expect(parseDateCell("23 Jul", "auto", 2026)).toEqual({ iso: "2026-07-23" });
  });

  test("still rejects an impossible yearless date rather than rolling it over", () => {
    const result = parseDateCell("Feb 30", "auto", 2026);
    expect(result.iso).toBeUndefined();
    expect(result.error).toMatch(/invalid date/);
  });

  test("reports an unrecognized month name as such, not as a missing year", () => {
    const result = parseDateCell("Xyz 23", "auto", 2026);
    expect(result.iso).toBeUndefined();
    expect(result.error).toMatch(/unrecognized month/);
  });

  test("a date that carries its own year ignores the statement year entirely", () => {
    expect(parseDateCell("Jul 23, 2024", "auto", 2026)).toEqual({ iso: "2024-07-23" });
    expect(parseDateCell("2024-07-23", "auto", 2026)).toEqual({ iso: "2024-07-23" });
  });
});

describe("needsStatementYear", () => {
  test("true when a sample names a month and day but carries no year", () => {
    expect(needsStatementYear(["Jul 22", "Jul 23"])).toBe(true);
  });

  test("true for the day-first spelling as well", () => {
    expect(needsStatementYear(["23 Jul"])).toBe(true);
  });

  test("false when every date already carries a year", () => {
    expect(needsStatementYear(["2026-07-23", "Jul 23, 2026", "23/07/2026"])).toBe(false);
  });

  test("false for text that is merely date-shaped — a real month name is required", () => {
    // Without the month-name check, a stray total row would wrongly demand
    // a statement year from the user.
    expect(needsStatementYear(["Total 5", "Balance 12"])).toBe(false);
  });

  test("ignores blank cells", () => {
    expect(needsStatementYear(["", "   "])).toBe(false);
  });
});

describe("suggestStatementYear", () => {
  test("suggests the current year when those dates have already passed", () => {
    const today = new Date(2026, 8, 11); // 11 September 2026
    expect(suggestStatementYear(["Jul 22", "Jul 23"], today)).toBe(2026);
  });

  test("suggests last year when this year would place a date in the future", () => {
    // A January statement listing December transactions: dating those to the
    // current year would put them in the future, and the server rejects
    // future-dated rows outright.
    const today = new Date(2026, 0, 15); // 15 January 2026
    expect(suggestStatementYear(["Dec 28", "Dec 30"], today)).toBe(2025);
  });

  test("a date landing exactly on today still counts as the current year", () => {
    const today = new Date(2026, 8, 11);
    expect(suggestStatementYear(["Sep 11"], today)).toBe(2026);
  });
});
