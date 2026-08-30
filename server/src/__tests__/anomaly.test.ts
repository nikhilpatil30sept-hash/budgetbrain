import { describe, test, expect } from "vitest";
import { evaluateAnomaly } from "../services/anomaly";

describe("evaluateAnomaly — category median rule (3x, >=5 prior)", () => {
  test("an expense exactly 3x the median is NOT flagged (strictly-greater-than only)", () => {
    const reasons = evaluateAnomaly({
      category: "Dining",
      amountCentsAbs: 3000, // exactly 3x the 1000 median below
      priorCategoryAmountsCentsAbs: [1000, 1000, 1000, 1000, 1000],
      monthlyIncomeCents: null,
    });
    expect(reasons).toEqual([]);
  });

  test("an expense just over 3x the median IS flagged", () => {
    const reasons = evaluateAnomaly({
      category: "Dining",
      amountCentsAbs: 3001,
      priorCategoryAmountsCentsAbs: [1000, 1000, 1000, 1000, 1000],
      monthlyIncomeCents: null,
    });
    expect(reasons.length).toBe(1);
  });

  test("exactly 5 prior transactions is enough to activate the rule", () => {
    const reasons = evaluateAnomaly({
      category: "Dining",
      amountCentsAbs: 3001,
      priorCategoryAmountsCentsAbs: [1000, 1000, 1000, 1000, 1000], // exactly 5
      monthlyIncomeCents: null,
    });
    expect(reasons.length).toBe(1);
  });

  test("only 4 prior transactions means the rule never fires, no matter the amount", () => {
    const reasons = evaluateAnomaly({
      category: "Dining",
      amountCentsAbs: 100_000, // absurdly large expense
      priorCategoryAmountsCentsAbs: [1000, 1000, 1000, 1000], // only 4
      monthlyIncomeCents: null,
    });
    expect(reasons).toEqual([]);
  });

  test("Uncategorized expenses are excluded from the median rule entirely", () => {
    const reasons = evaluateAnomaly({
      category: "Uncategorized",
      amountCentsAbs: 100_000,
      priorCategoryAmountsCentsAbs: [1000, 1000, 1000, 1000, 1000],
      monthlyIncomeCents: null,
    });
    expect(reasons).toEqual([]);
  });
});

describe("evaluateAnomaly — 30%-of-income rule", () => {
  test("an expense exactly at 30% of income is NOT flagged", () => {
    const reasons = evaluateAnomaly({
      category: "Shopping",
      amountCentsAbs: 3000, // exactly 30% of the 10,000-cent income below
      priorCategoryAmountsCentsAbs: [],
      monthlyIncomeCents: 10_000,
    });
    expect(reasons).toEqual([]);
  });

  test("an expense just over 30% of income IS flagged", () => {
    const reasons = evaluateAnomaly({
      category: "Shopping",
      amountCentsAbs: 3001,
      priorCategoryAmountsCentsAbs: [],
      monthlyIncomeCents: 10_000,
    });
    expect(reasons.length).toBe(1);
  });

  test("the income rule is switched off entirely when income is not set", () => {
    const reasons = evaluateAnomaly({
      category: "Shopping",
      amountCentsAbs: 1_000_000,
      priorCategoryAmountsCentsAbs: [],
      monthlyIncomeCents: null,
    });
    expect(reasons).toEqual([]);
  });
});
