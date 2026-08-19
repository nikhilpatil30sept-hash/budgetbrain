/**
 * Normalize a raw merchant/description string into a cache key.
 * Rule (from requirements 3.2): lowercase, strip digits, strip punctuation,
 * collapse whitespace, truncate to 40 chars.
 * "WALMART #4521" and "Walmart #7788" must produce the same key.
 */
export function merchantKey(description: string): string {
  return description
    .toLowerCase()
    .replace(/\d+/g, "")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .trim();
}
