import { describe, test, expect } from "vitest";
import {
  findTransactionTableStart,
  isLikelyScanned,
  prepareStatementForAI,
  redactIdentifiers,
} from "../pdfImport";

describe("isLikelyScanned", () => {
  test("flags a PDF with no extractable text as scanned", () => {
    expect(isLikelyScanned(["", "", ""])).toBe(true);
  });

  test("flags an empty page list as scanned", () => {
    expect(isLikelyScanned([])).toBe(true);
  });

  test("does not flag a page with a normal amount of text", () => {
    const page = "Statement period Jan 1 - Jan 31\n".repeat(20);
    expect(isLikelyScanned([page])).toBe(false);
  });
});

describe("findTransactionTableStart", () => {
  test("finds a header row naming the usual column labels", () => {
    const text = [
      "Jane Doe",
      "123 Main St",
      "Account Number: 1234567890",
      "Date Description Amount Balance",
      "Jul 1 COFFEE SHOP -4.50 995.50",
      "Jul 2 PAYROLL 2000.00 2995.50",
    ].join("\n");
    const idx = findTransactionTableStart(text);
    expect(text.split("\n")[idx]).toBe("Date Description Amount Balance");
  });

  test("falls back to a run of date-like lines when there's no header row", () => {
    const text = [
      "Jane Doe",
      "123 Main St",
      "Statement date: Jul 31, 2026",
      "Jul 1 COFFEE SHOP -4.50",
      "Jul 2 PAYROLL 2000.00",
      "Jul 3 GROCERIES -50.00",
      "Jul 4 GAS -30.00",
    ].join("\n");
    const idx = findTransactionTableStart(text);
    expect(text.split("\n")[idx]).toBe("Jul 1 COFFEE SHOP -4.50");
  });

  test("returns -1 when no transaction table can be found", () => {
    const text = "Jane Doe\n123 Main St\nThank you for banking with us.";
    expect(findTransactionTableStart(text)).toBe(-1);
  });
});

describe("redactIdentifiers", () => {
  test("redacts a long account number", () => {
    expect(redactIdentifiers("Account Number: 123456789012")).toBe(
      "Account Number: [REDACTED]"
    );
  });

  test("redacts an email address", () => {
    expect(redactIdentifiers("Contact: jane.doe@example.com")).toBe(
      "Contact: [REDACTED]"
    );
  });

  test("redacts a SIN/SSN-shaped number", () => {
    expect(redactIdentifiers("SIN: 123-45-6789")).toBe("SIN: [REDACTED]");
  });

  test("redacts a phone number", () => {
    expect(redactIdentifiers("Call us at (555) 123-4567")).toBe(
      "Call us at [REDACTED]"
    );
  });

  test("does not touch a short reference number in a transaction description", () => {
    expect(redactIdentifiers("CHEQUE #4521")).toBe("CHEQUE #4521");
  });

  test("does not touch a dollar amount", () => {
    expect(redactIdentifiers("Jul 1 COFFEE SHOP -4.50")).toBe(
      "Jul 1 COFFEE SHOP -4.50"
    );
  });

  test("drops a whole line repeating the cardholder's name and a masked card number", () => {
    // Some banks repeat a "MR NAME - masked card" header on every page, not
    // just the first, so it can land mid-document after the crop point.
    // The masked number uses bank-style X placeholders ("4537 XXXX XXXX
    // 1034"), which a plain digit-run regex never matches, so the whole
    // line is dropped instead of partially redacted.
    const text = [
      "REF.# DATE DATE DETAILS AMOUNT($)",
      "MR NIKHIL PATIL - 4537 XXXX XXXX 1034",
      "001 Jul 18 Jul 20 LCBO/RAO #385 MISSISSAUGA ON 42.75",
    ].join("\n");
    const result = redactIdentifiers(text);
    expect(result).not.toContain("NIKHIL PATIL");
    expect(result).not.toContain("4537");
    expect(result).not.toContain("1034");
    expect(result).toContain("LCBO/RAO #385 MISSISSAUGA ON 42.75");
  });

  test("drops a salutation-prefixed header line even without a masked number", () => {
    const text = "MRS JANE DOE\nJul 1 COFFEE SHOP -4.50";
    expect(redactIdentifiers(text)).toBe("Jul 1 COFFEE SHOP -4.50");
  });
});

describe("prepareStatementForAI", () => {
  test("crops to the transaction table and marks headerStripped true", () => {
    const text = [
      "Jane Doe",
      "Account Number: 1234567890",
      "Date Description Amount",
      "Jul 1 COFFEE SHOP -4.50",
    ].join("\n");
    const result = prepareStatementForAI(text);
    expect(result.headerStripped).toBe(true);
    expect(result.text).not.toContain("Jane Doe");
    expect(result.text).not.toContain("1234567890");
    expect(result.text).toContain("Jul 1 COFFEE SHOP -4.50");
  });

  test("falls back to whole-document redaction and marks headerStripped false", () => {
    const text = "Jane Doe\nAccount Number: 1234567890\nThanks for banking with us.";
    const result = prepareStatementForAI(text);
    expect(result.headerStripped).toBe(false);
    expect(result.text).not.toContain("1234567890");
  });
});
