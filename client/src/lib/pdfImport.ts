/**
 * PDF bank-statement import helpers. Extraction happens entirely in the
 * browser (pdfjs-dist) — the raw PDF never needs to leave it. Everything
 * here is a pure function on strings so it's unit-testable without a real
 * PDF file; only `extractPdfPages` touches pdfjs-dist itself.
 *
 * Privacy design: Gemini's only job is to read back {date, description,
 * amount} exactly as printed in the transaction table — it never needs the
 * account holder's name, address, or account/card number. So instead of
 * trying to regex-mask every possible PII field (fragile and bank-specific),
 * we find where the transaction table starts and only send that part
 * onward; the identity block above it is never transmitted at all. A
 * defense-in-depth regex pass then also redacts any long identifier-shaped
 * digit runs, emails, or phone numbers that remain, in case the boundary
 * heuristic under- or over-shoots.
 */

import * as pdfjsLib from "pdfjs-dist";

// Vite-native worker wiring (the pattern pdfjs-dist itself recommends for
// bundlers): resolves to a real asset URL at build time, no manual copy
// step and no dependency on Vite-specific `?url` import types.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

/** One text item from pdfjs's getTextContent(), narrowed to what we use. */
interface TextItem {
  str: string;
  transform: number[]; // [a, b, c, d, x, y]
}

/**
 * Reconstruct line-ish text from pdfjs's flat item list: group items whose
 * y-position is within a small tolerance (same visual line), then join
 * left-to-right. pdfjs gives items in document order, not always strict
 * reading order, so we sort by (y desc, x asc) before grouping.
 */
function itemsToText(items: TextItem[]): string {
  const withPos = items
    .filter((it) => typeof it.str === "string")
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));
  withPos.sort((a, b) => (b.y - a.y === 0 ? a.x - b.x : b.y - a.y));

  const lines: { y: number; parts: { x: number; str: string }[] }[] = [];
  const TOLERANCE = 2;
  for (const it of withPos) {
    let line = lines.find((l) => Math.abs(l.y - it.y) <= TOLERANCE);
    if (!line) {
      line = { y: it.y, parts: [] };
      lines.push(line);
    }
    line.parts.push({ x: it.x, str: it.str });
  }
  return lines
    .map((l) =>
      l.parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((l) => l.length > 0)
    .join("\n");
}

/** Extract one text string per page of a digital PDF. */
export async function extractPdfPages(file: File): Promise<string[]> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(itemsToText(content.items as unknown as TextItem[]));
  }
  return pages;
}

/**
 * True when a PDF has no meaningful text layer — i.e. it's a scanned image
 * rather than a digital statement. We refuse these outright rather than
 * attempting OCR, per the project's explicit digital-only scope.
 */
export function isLikelyScanned(pages: string[]): boolean {
  if (pages.length === 0) return true;
  const totalChars = pages.reduce((n, p) => n + p.replace(/\s/g, "").length, 0);
  return totalChars / pages.length < 40; // near-empty per page → no real text layer
}

const HEADER_TOKENS = [
  "date",
  "description",
  "details",
  "transaction",
  "amount",
  "debit",
  "credit",
  "withdrawal",
  "deposit",
  "balance",
];

// Reuses the same date shapes csv.ts already knows how to parse, kept in
// sync loosely (this only needs to *detect* a date-looking line, not parse
// it — full parsing still goes through csv.ts later in the pipeline).
const DATE_LIKE = [
  /^\d{4}-\d{1,2}-\d{1,2}\b/,
  /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/,
  /^[A-Za-z]{3,9}\.?\s+\d{1,2}\b/,
  /^\d{1,2}\s+[A-Za-z]{3,9}\.?\b/,
];

function isDateLike(line: string): boolean {
  const s = line.trim();
  return DATE_LIKE.some((re) => re.test(s));
}

/**
 * Find the line index where the transaction table begins. Tries a header
 * row first (a line naming ≥3 of the usual column labels), then falls back
 * to the first date-like line that kicks off a run of several more —
 * distinguishing the transaction list from a single stray date elsewhere
 * in the header (e.g. a statement date). Returns -1 if neither is found.
 */
export function findTransactionTableStart(text: string): number {
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    const hits = HEADER_TOKENS.filter((tok) => lower.includes(tok)).length;
    if (hits >= 3) return i;
  }

  for (let i = 0; i < lines.length; i++) {
    if (!isDateLike(lines[i])) continue;
    let following = 0;
    for (let j = i + 1; j < Math.min(lines.length, i + 11); j++) {
      if (isDateLike(lines[j])) following++;
    }
    if (following >= 3) return i;
  }

  return -1;
}

// Whole-line identity/header filter, applied before the digit-level
// redaction below. Some banks repeat a "MR NAME – 4537 XXXX XXXX 1034"
// style header on every page of the statement, not just the first — so
// cropping from the first transaction-table header line onward isn't
// enough, and the account number in these lines uses bank-style X
// placeholders that plain digit-run regexes don't match at all. Rather
// than trying to regex-match a name (no fixed shape), we drop the whole
// line whenever it looks like one of these header lines: real transaction
// descriptions don't start with a salutation and essentially never
// contain a run of masked "XX" characters, so this is a safe signal.
const IDENTITY_LINE_PATTERNS: RegExp[] = [
  /^(mr|mrs|ms|mx|dr|miss|prof)\.?\s/i, // salutation-prefixed name/header lines
  /[Xx]{2,}/, // masked account/card numbers (e.g. "4537 XXXX XXXX 1034")
];

function isIdentityLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return IDENTITY_LINE_PATTERNS.some((re) => re.test(trimmed));
}

// Defense-in-depth redaction, applied regardless of whether the header
// boundary was found. Deliberately conservative: only long digit runs
// (9+) are touched, since shorter ones are common in legitimate
// transaction descriptions (cheque numbers, short references) and in
// dollar amounts — a false positive here would break extraction, not just
// over-redact.
const REDACT_PATTERNS: RegExp[] = [
  // Account/card/customer numbers, however grouped — including bank-style
  // asterisk masks (e.g. "*****14*6583", "******1452"), not just plain
  // digits. Deliberately does NOT allow a plain space inside the run
  // (only digits, "*" and "-"): a masked reference in a transaction line
  // sits right next to the amount that follows it with only a single
  // space between them (e.g. "*****14*6583 330.00"), and an earlier
  // version of this pattern that allowed spaces greedily swallowed the
  // amount along with it. Space-grouped numbers (e.g. "4537 XXXX XXXX
  // 1034") are instead caught whole-line by isIdentityLine below. No \b
  // is used at all here — the character class itself is restrictive
  // enough to bound the match, and \b can't match next to a leading or
  // trailing "*" (a non-word char) the way it couldn't next to "(" in the
  // phone pattern below.
  /[\d*][\d*-]{8,}[\d*]/g,
  /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, // SIN/SSN shape
  /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/g, // email addresses
  /(?:\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, // phone numbers — no leading \b: it can't match right before "(" when preceded by a space (both non-word), which left the paren behind unredacted
];

export function redactIdentifiers(text: string): string {
  const withoutIdentityLines = text
    .split("\n")
    .filter((line) => !isIdentityLine(line))
    .join("\n");

  let out = withoutIdentityLines;
  for (const re of REDACT_PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

export interface PreparedStatement {
  text: string;
  /** False when the transaction-table boundary couldn't be found — the
   *  whole document was redacted-in-place instead of cropped, so the UI
   *  should show an extra "please double check" warning. */
  headerStripped: boolean;
}

export function prepareStatementForAI(fullText: string): PreparedStatement {
  const start = findTransactionTableStart(fullText);
  if (start === -1) {
    return { text: redactIdentifiers(fullText), headerStripped: false };
  }
  const cropped = fullText.split("\n").slice(start).join("\n");
  return { text: redactIdentifiers(cropped), headerStripped: true };
}
