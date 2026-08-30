import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { stripFences, parseJsonArrayLoose, callGemini, GeminiError } from "../services/gemini";

describe("stripFences", () => {
  test("removes ```json fences around a response", () => {
    expect(stripFences("```json\n[1,2,3]\n```")).toBe("[1,2,3]");
  });

  test("leaves an already-clean response unchanged", () => {
    expect(stripFences("[1,2,3]")).toBe("[1,2,3]");
  });
});

describe("parseJsonArrayLoose", () => {
  test("parses a clean JSON array", () => {
    expect(parseJsonArrayLoose('[{"i":0,"category":"Groceries"}]')).toEqual([
      { i: 0, category: "Groceries" },
    ]);
  });

  test("parses a JSON array wrapped in markdown fences", () => {
    const fenced = '```json\n[{"i":0,"category":"Groceries"}]\n```';
    expect(parseJsonArrayLoose(fenced)).toEqual([{ i: 0, category: "Groceries" }]);
  });

  test("extracts the array even when the model adds commentary around it", () => {
    const chatty = 'Sure! Here you go: [{"i":0,"category":"Groceries"}] Hope that helps!';
    expect(parseJsonArrayLoose(chatty)).toEqual([{ i: 0, category: "Groceries" }]);
  });

  test("throws on a response with no JSON array in it at all", () => {
    expect(() => parseJsonArrayLoose("This is not JSON at all")).toThrow();
  });
});

describe("callGemini error handling (network mocked, no real API calls)", () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    // callGemini bails out immediately if no key looks present, so we plant
    // a fake one — it's never actually sent anywhere real, since fetch itself
    // is about to be replaced below.
    process.env.GEMINI_API_KEY = "fake-test-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.GEMINI_API_KEY = originalKey;
  });

  test("throws a rate_limit GeminiError on a 429 response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 429 } as Response);
    await expect(callGemini("prompt", "test-label", 1)).rejects.toThrow(GeminiError);
  });

  test("throws a server GeminiError on a 500 response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 500 } as Response);
    await expect(callGemini("prompt", "test-label", 1)).rejects.toThrow(GeminiError);
  });
});
