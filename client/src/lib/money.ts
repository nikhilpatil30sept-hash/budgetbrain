/**
 * All money is integer cents everywhere except the exact moment it is shown
 * or typed. These helpers do the conversion with integer/string math only —
 * no floats, no rounding artifacts.
 */

export function formatCents(cents: number, symbol = "$"): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const rem = String(abs % 100).padStart(2, "0");
  return `${sign}${symbol}${dollars}.${rem}`;
}

/** Compact form for chart axes: $1.2k / $850 */
export function formatCentsCompact(cents: number, symbol = "$"): string {
  const abs = Math.abs(cents);
  const sign = cents < 0 ? "-" : "";
  if (abs >= 100_000) {
    const k = abs / 100_000;
    return `${sign}${symbol}${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
  }
  return `${sign}${symbol}${Math.round(abs / 100)}`;
}

/**
 * Parse a user-typed positive amount ("1,234.56", "$12", "12.5") to integer
 * cents using string math. Returns null when invalid (bad chars, more than
 * 2 decimal places, or zero).
 */
export function parsePositiveAmountToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  const m = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  const dollars = parseInt(m[1], 10);
  const centsPart = m[2] ? parseInt(m[2].padEnd(2, "0"), 10) : 0;
  const total = dollars * 100 + centsPart;
  return total === 0 ? null : total;
}
