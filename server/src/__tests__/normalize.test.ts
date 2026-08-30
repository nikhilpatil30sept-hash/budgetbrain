import { describe, test, expect } from "vitest";
import { merchantKey } from "../lib/normalize";

describe("merchantKey", () => {
  test("treats differently-formatted store numbers as the same merchant", () => {
    expect(merchantKey("WALMART #4521")).toBe(merchantKey("Walmart #7788"));
    expect(merchantKey("WALMART #4521")).toBe("walmart");
  });

  test("strips digits mixed into the name", () => {
    // Matches TEST-PLAN.md 6.8: "7-ELEVEN" becomes just "eleven".
    expect(merchantKey("7-ELEVEN")).toBe("eleven");
  });

  test("strips punctuation and collapses the resulting whitespace", () => {
    expect(merchantKey("SQ *BLUE BOTTLE")).toBe("sq blue bottle");
  });

  test("a description made only of digits normalizes to an empty string", () => {
    // TEST-PLAN.md 6.8: this merchant silently never gets categorized as a
    // result — worth locking in as documented behavior, not an accident.
    expect(merchantKey("4829571")).toBe("");
  });

  test("truncates at 40 characters, so two long names differing only after that point collapse together", () => {
    const commonPrefix = "abcdefghijklmnopqrstuvwxyzabcdefghijklmn"; // exactly 40 letters
    expect(commonPrefix.length).toBe(40);
    expect(merchantKey(commonPrefix + "aaa")).toBe(commonPrefix);
    expect(merchantKey(commonPrefix + "zzz")).toBe(commonPrefix);
  });
});
