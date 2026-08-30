import { describe, test, expect } from "vitest";
import { formatCents, parsePositiveAmountToCents } from "../money";

describe("formatCents", () => {
  test("formats 1999 cents as $19.99", () => {
    expect(formatCents(1999)).toBe("$19.99");
  });

  test("formats a negative amount with a leading minus sign", () => {
    expect(formatCents(-1999)).toBe("-$19.99");
  });

  test("formats zero cents as $0.00", () => {
    expect(formatCents(0)).toBe("$0.00");
  });
});

describe("parsePositiveAmountToCents", () => {
  test("converts a plain amount like 19.99 to 1999 cents", () => {
    expect(parsePositiveAmountToCents("19.99")).toBe(1999);
  });

  test("strips $ and commas before parsing", () => {
    expect(parsePositiveAmountToCents("$1,234.56")).toBe(123456);
  });

  test("rejects $0.00 as an invalid amount", () => {
    expect(parsePositiveAmountToCents("0.00")).toBeNull();
  });

  test("rejects a third decimal place instead of rounding it", () => {
    expect(parsePositiveAmountToCents("10.005")).toBeNull();
  });
});
