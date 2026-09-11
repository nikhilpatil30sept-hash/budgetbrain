/**
 * CSV mapping + parsing rules from requirements 4.2. Parsing happens
 * client-side (papaparse handles the raw CSV); these helpers turn mapped
 * cells into {date, description, amount_cents} rows, collecting per-row
 * errors instead of throwing. The server re-validates everything.
 */

export type DateFormat = "auto" | "MDY" | "DMY";

export interface ColumnMapping {
  dateCol: string;
  descCol: string;
  amountMode: "single" | "debit_credit";
  amountCol: string;
  debitCol: string;
  creditCol: string;
  dateFormat: DateFormat;
  expensesArePositive: boolean;
  /**
   * Year to apply to dates that don't carry one ("Jul 23"). Undefined until
   * the user picks it — we never infer it silently, because guessing wrong
   * misfiles a transaction by a full year.
   */
  statementYear?: number;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function validDate(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null; // e.g. Feb 30
  }
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Parse one date cell to ISO. Supported: YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY,
 * DD-MM-YYYY, "Mon DD, YYYY", and the yearless "Mon DD" / "DD Mon" that bank
 * and credit-card statements use. Numeric X/Y/Z dates need `format` unless
 * one side is unambiguous (>12); yearless dates need `statementYear`.
 */
export function parseDateCell(
  raw: string,
  format: DateFormat,
  statementYear?: number
): { iso?: string; error?: string } {
  const s = raw.trim();
  if (!s) return { error: "empty date" };

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    const iso = validDate(+m[1], +m[2], +m[3]);
    return iso ? { iso } : { error: `invalid date "${s}"` };
  }

  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (!month) return { error: `unrecognized month in "${s}"` };
    const iso = validDate(+m[3], month, +m[2]);
    return iso ? { iso } : { error: `invalid date "${s}"` };
  }

  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = +m[3];
    let month: number, day: number;
    if (format === "MDY") [month, day] = [a, b];
    else if (format === "DMY") [month, day] = [b, a];
    else if (a > 12 && b <= 12) [month, day] = [b, a]; // must be DMY
    else if (b > 12 && a <= 12) [month, day] = [a, b]; // must be MDY
    else return { error: `ambiguous date "${s}" — pick a date format above` };
    const iso = validDate(y, month, day);
    return iso ? { iso } : { error: `invalid date "${s}"` };
  }

  // Yearless month-name dates: "Jul 23", "Jul. 23", "23 Jul". Statements
  // routinely omit the year because it's printed once in the statement
  // header rather than on every line. The year is never inferred here — the
  // caller supplies it explicitly, so a wrong year is a visible choice
  // rather than a silent twelve-month misfiling.
  let monthName: string | undefined;
  let dayNum: number | undefined;

  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})$/.exec(s);
  if (m) {
    monthName = m[1];
    dayNum = +m[2];
  } else {
    m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?$/.exec(s);
    if (m) {
      dayNum = +m[1];
      monthName = m[2];
    }
  }

  if (monthName !== undefined && dayNum !== undefined) {
    const month = MONTHS[monthName.slice(0, 3).toLowerCase()];
    if (!month) return { error: `unrecognized month in "${s}"` };
    if (!statementYear) return { error: `no year in "${s}" — pick the statement year above` };
    const iso = validDate(statementYear, month, dayNum);
    return iso ? { iso } : { error: `invalid date "${s}"` };
  }

  return { error: `unsupported date format "${s}"` };
}

/** True if any numeric date in the sample is ambiguous without a format choice. */
export function needsDateFormatChoice(samples: string[]): boolean {
  for (const s of samples) {
    const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s.trim());
    if (m && +m[1] <= 12 && +m[2] <= 12) return true;
  }
  return false;
}

/**
 * True if any sampled date names a month and a day but carries no year —
 * the shape credit-card statements use. Requires a real month name, so a
 * stray cell like "Total 5" doesn't trigger the year prompt.
 */
export function needsStatementYear(samples: string[]): boolean {
  for (const raw of samples) {
    const s = raw.trim();
    if (!s) continue;
    let m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})$/.exec(s);
    if (!m) m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?$/.exec(s);
    if (!m) continue;
    const name = /^\d/.test(m[1]) ? m[2] : m[1];
    if (MONTHS[name.slice(0, 3).toLowerCase()]) return true;
  }
  return false;
}

/**
 * A sensible *default* for the statement-year picker: this year, unless that
 * would push any sampled date into the future — a January statement listing
 * December transactions — in which case last year. Only ever a default; the
 * picker stays visible and the user can override it.
 */
export function suggestStatementYear(samples: string[], today: Date = new Date()): number {
  const year = today.getFullYear();
  const cutoff = `${year}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
  for (const s of samples) {
    const res = parseDateCell(s, "auto", year);
    if (res.iso && res.iso > cutoff) return year - 1;
  }
  return year;
}

/**
 * Parse one amount cell to signed integer cents. Handles currency symbols,
 * thousands separators, parentheses-as-negative, and explicit +/-.
 * String math only — never parseFloat.
 */
export function parseAmountCell(raw: string): { cents?: number; error?: string } {
  let s = raw.trim();
  if (!s) return { error: "empty amount" };

  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) {
    negative = true;
    s = paren[1].trim();
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  s = s.replace(/[$€£¥,\s]/g, "");

  const m = /^(\d{1,10})(?:\.(\d{1,4}))?$/.exec(s);
  if (!m) return { error: `unparseable amount "${raw.trim()}"` };
  if (m[2] && m[2].length > 2) return { error: `more than 2 decimal places in "${raw.trim()}"` };

  const cents = parseInt(m[1], 10) * 100 + (m[2] ? parseInt(m[2].padEnd(2, "0"), 10) : 0);
  return { cents: negative ? -cents : cents };
}

export interface ParsedRow {
  date: string;
  description: string;
  amount_cents: number;
}

export interface RowError {
  row: number;
  reason: string;
}

/**
 * Convert papaparse row objects into API-ready rows using the mapping.
 * Invalid rows land in `errors`, never abort the whole conversion.
 */
export function convertRows(
  rows: Record<string, string>[],
  mapping: ColumnMapping
): { parsed: ParsedRow[]; errors: RowError[] } {
  const parsed: ParsedRow[] = [];
  const errors: RowError[] = [];

  rows.forEach((row, idx) => {
    const rowNum = idx + 1;
    const isBlank = Object.values(row).every((v) => !String(v ?? "").trim());
    if (isBlank) return; // trailing blank lines aren't errors

    const dateRes = parseDateCell(
      String(row[mapping.dateCol] ?? ""),
      mapping.dateFormat,
      mapping.statementYear
    );
    if (!dateRes.iso) {
      errors.push({ row: rowNum, reason: dateRes.error! });
      return;
    }

    const description = String(row[mapping.descCol] ?? "").trim();
    if (!description) {
      errors.push({ row: rowNum, reason: "empty description" });
      return;
    }

    let cents: number;
    if (mapping.amountMode === "single") {
      const res = parseAmountCell(String(row[mapping.amountCol] ?? ""));
      if (res.cents === undefined) {
        errors.push({ row: rowNum, reason: res.error! });
        return;
      }
      cents = res.cents;
      // Some banks export expenses as positive numbers — user opts in to invert.
      if (mapping.expensesArePositive) cents = -cents;
    } else {
      const debitRaw = String(row[mapping.debitCol] ?? "").trim();
      const creditRaw = String(row[mapping.creditCol] ?? "").trim();
      if (debitRaw && creditRaw) {
        errors.push({ row: rowNum, reason: "both debit and credit are set" });
        return;
      }
      if (!debitRaw && !creditRaw) {
        errors.push({ row: rowNum, reason: "neither debit nor credit is set" });
        return;
      }
      const res = parseAmountCell(debitRaw || creditRaw);
      if (res.cents === undefined) {
        errors.push({ row: rowNum, reason: res.error! });
        return;
      }
      // Debit → expense (negative); credit → income (positive).
      cents = debitRaw ? -Math.abs(res.cents) : Math.abs(res.cents);
    }

    if (cents === 0) {
      errors.push({ row: rowNum, reason: "amount is zero" });
      return;
    }

    parsed.push({ date: dateRes.iso, description, amount_cents: cents });
  });

  return { parsed, errors };
}

/** Auto-detect likely columns from header names (requirements 4.2.2). */
export function autoDetectMapping(headers: string[]): Partial<ColumnMapping> {
  const lower = headers.map((h) => h.toLowerCase());
  const find = (...keys: string[]) => {
    for (const key of keys) {
      const i = lower.findIndex((h) => h.includes(key));
      if (i !== -1) return headers[i];
    }
    return undefined;
  };
  const debit = find("debit", "withdrawal");
  const credit = find("credit", "deposit");
  return {
    dateCol: find("date", "posted"),
    descCol: find("description", "memo", "payee", "merchant", "name"),
    amountCol: find("amount"),
    debitCol: debit,
    creditCol: credit,
    amountMode: debit && credit && !find("amount") ? "debit_credit" : "single",
  };
}
