import { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { motion } from "framer-motion";
import { api, ApiError } from "../lib/api";
import {
  autoDetectMapping,
  convertRows,
  needsDateFormatChoice,
  type ColumnMapping,
  type DateFormat,
  type RowError,
} from "../lib/csv";
import { celebrate } from "../lib/confetti";
import type { ImportResult } from "../lib/types";
import { Card, EmptyState, Spinner } from "../components/Bits";
import { Reveal } from "../components/Reveal";
import { useToast } from "../components/Toast";

const MAX_ROWS = 1000;

interface Summary {
  imported: number;
  skipped: RowError[];
  duplicates: { row: number; description: string }[];
}

/**
 * CSV import (requirements 4.2): paste or upload → papaparse preview of the
 * first 20 rows → mandatory column mapping (auto-detected, always
 * overridable) → date-format radio when ambiguous → import with row-level
 * skip reporting and duplicate warnings. Logic unchanged; now it celebrates.
 */
export function ImportPage({ onImported }: { onImported: (categorizeNow: boolean) => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rawText, setRawText] = useState("");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);

  function parseText(text: string) {
    setSummary(null);
    const result = Papa.parse<Record<string, string>>(text.trim(), {
      header: true,
      skipEmptyLines: true,
    });
    if (result.errors.length && result.data.length === 0) {
      toast("error", `Hmm, couldn't parse that CSV: ${result.errors[0].message}`);
      return;
    }
    const hdrs = result.meta.fields ?? [];
    if (hdrs.length < 2) {
      toast("error", "That doesn't look like a CSV with a header row (we need at least 2 columns).");
      return;
    }
    setRawText(text);
    setRows(result.data);
    setHeaders(hdrs);
    const auto = autoDetectMapping(hdrs);
    setMapping({
      dateCol: auto.dateCol ?? hdrs[0],
      descCol: auto.descCol ?? hdrs[1] ?? hdrs[0],
      amountMode: auto.amountMode ?? "single",
      amountCol: auto.amountCol ?? hdrs[hdrs.length - 1],
      debitCol: auto.debitCol ?? "",
      creditCol: auto.creditCol ?? "",
      dateFormat: "auto",
      expensesArePositive: false,
    });
  }

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => parseText(String(reader.result ?? ""));
    reader.onerror = () => toast("error", "Couldn't read that file");
    reader.readAsText(file);
  }

  const preview = rows.slice(0, 20);
  const dateSamples = useMemo(
    () => (mapping ? rows.slice(0, 200).map((r) => String(r[mapping.dateCol] ?? "")) : []),
    [rows, mapping]
  );
  const ambiguousDates = useMemo(() => needsDateFormatChoice(dateSamples), [dateSamples]);

  async function runImport() {
    if (!mapping) return;
    if (rows.length > MAX_ROWS) {
      toast("error", `Whoa — ${rows.length} rows! Imports are capped at ${MAX_ROWS}. Split the file and retry.`);
      return;
    }
    if (ambiguousDates && mapping.dateFormat === "auto") {
      toast("error", "Dates like 03/04/2025 could go either way — pick MM/DD or DD/MM above first.");
      return;
    }
    setImporting(true);
    try {
      const { parsed, errors } = convertRows(rows, mapping);
      if (parsed.length === 0) {
        setSummary({ imported: 0, skipped: errors, duplicates: [] });
        toast("error", "No importable rows — double-check the column mapping.");
        return;
      }
      const res = await api.post<ImportResult>("/api/transactions/import", {
        rows: parsed.map((p) => ({ ...p, category: "Uncategorized" })),
      });
      // Server-side skips are numbered within the sent batch; merge both lists.
      setSummary({
        imported: res.imported,
        skipped: [...errors, ...res.skipped.map((s) => ({ row: s.row, reason: `${s.reason} (server)` }))],
        duplicates: res.duplicates,
      });
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Import failed — nothing was saved.");
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setRawText("");
    setRows([]);
    setHeaders([]);
    setMapping(null);
    setSummary(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  if (summary) {
    return <ImportSummary summary={summary} onImported={onImported} onReset={reset} />;
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-lg font-extrabold text-ink-900">📥 Bring in a bank CSV</h2>
        <p className="mt-1 text-sm font-medium text-ink-600">
          Upload or paste an export from your bank — you'll map the columns before anything is saved. Up to {MAX_ROWS}{" "}
          rows per trip.
        </p>
        <label className="mt-3 block cursor-pointer rounded-blob border-[3px] border-dashed border-cream-200 bg-cream-50 p-6 text-center transition-colors hover:border-brand-300 hover:bg-brand-50">
          <span className="text-3xl" aria-hidden>
            🗂️
          </span>
          <p className="mt-1 text-sm font-extrabold text-ink-900">Click to choose a .csv file</p>
          <p className="text-xs font-medium text-ink-400">or paste the raw text below</p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            className="hidden"
          />
        </label>
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          onBlur={() => rawText.trim() && parseText(rawText)}
          placeholder={"Date,Description,Amount\n2026-06-01,TRADER JOE'S #552,-45.23"}
          rows={5}
          className="mt-3 w-full rounded-2xl border-2 border-cream-200 p-3 font-mono text-xs transition-colors focus:border-brand-300 focus:outline-none"
        />
        {rawText.trim() && rows.length === 0 && (
          <button type="button" onClick={() => parseText(rawText)} className="btn-ghost mt-2">
            Parse pasted text
          </button>
        )}
      </Card>

      {mapping && rows.length > 0 ? (
        <>
          <Reveal distance={20}>
          <Card>
            <h3 className="text-sm font-extrabold text-ink-900">🗺️ Map the columns</h3>
            <p className="mt-1 text-xs font-medium text-ink-400">
              We took a guess from the headers — fix anything that looks off. {rows.length} data row
              {rows.length === 1 ? "" : "s"} found.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-4">
              <label className="flex flex-col gap-1 text-xs font-extrabold text-ink-600">
                Date column
                <select value={mapping.dateCol} onChange={(e) => setMapping({ ...mapping, dateCol: e.target.value })} className="field">
                  {headers.map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-extrabold text-ink-600">
                Description column
                <select value={mapping.descCol} onChange={(e) => setMapping({ ...mapping, descCol: e.target.value })} className="field">
                  {headers.map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-extrabold text-ink-600">
                Amount style
                <select
                  value={mapping.amountMode}
                  onChange={(e) => setMapping({ ...mapping, amountMode: e.target.value as ColumnMapping["amountMode"] })}
                  className="field"
                >
                  <option value="single">One amount column</option>
                  <option value="debit_credit">Separate debit / credit columns</option>
                </select>
              </label>
              {mapping.amountMode === "single" ? (
                <label className="flex flex-col gap-1 text-xs font-extrabold text-ink-600">
                  Amount column
                  <select value={mapping.amountCol} onChange={(e) => setMapping({ ...mapping, amountCol: e.target.value })} className="field">
                    {headers.map((h) => (
                      <option key={h}>{h}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  <label className="flex flex-col gap-1 text-xs font-extrabold text-ink-600">
                    Debit column (money out)
                    <select value={mapping.debitCol} onChange={(e) => setMapping({ ...mapping, debitCol: e.target.value })} className="field">
                      <option value="">—</option>
                      {headers.map((h) => (
                        <option key={h}>{h}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-extrabold text-ink-600">
                    Credit column (money in)
                    <select value={mapping.creditCol} onChange={(e) => setMapping({ ...mapping, creditCol: e.target.value })} className="field">
                      <option value="">—</option>
                      {headers.map((h) => (
                        <option key={h}>{h}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-6">
              <fieldset className={ambiguousDates ? "" : "opacity-60"}>
                <legend className="text-xs font-extrabold text-ink-600">
                  Date format{" "}
                  {ambiguousDates && <span className="text-honey-700">— required, these dates could go either way</span>}
                </legend>
                <div className="mt-1 flex gap-4 text-sm font-bold text-ink-600">
                  {(
                    [
                      ["auto", "Auto (ISO / unambiguous)"],
                      ["MDY", "MM/DD/YYYY"],
                      ["DMY", "DD/MM/YYYY"],
                    ] as [DateFormat, string][]
                  ).map(([value, label]) => (
                    <label key={value} className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        name="dateFormat"
                        checked={mapping.dateFormat === value}
                        onChange={() => setMapping({ ...mapping, dateFormat: value })}
                        className="accent-brand-500"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              {mapping.amountMode === "single" && (
                <label className="flex items-center gap-2 text-sm font-bold text-ink-600">
                  <input
                    type="checkbox"
                    checked={mapping.expensesArePositive}
                    onChange={(e) => setMapping({ ...mapping, expensesArePositive: e.target.checked })}
                    className="accent-brand-500"
                  />
                  Expenses are positive numbers in this file (flip the sign)
                </label>
              )}
            </div>
          </Card>
          </Reveal>

          <Reveal distance={30} delay={0.05}>
          <Card className="p-0">
            <h3 className="border-b-2 border-cream-100 p-3 text-sm font-extrabold text-ink-900">
              👓 Preview — first {preview.length} rows
            </h3>
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-cream-50">
                  <tr>
                    {headers.map((h) => (
                      <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-extrabold text-ink-600">
                        {h}
                        {h === mapping.dateCol && (
                          <span className="ml-1 rounded-full bg-brand-100 px-1.5 font-extrabold text-brand-600">date</span>
                        )}
                        {h === mapping.descCol && (
                          <span className="ml-1 rounded-full bg-grow-50 px-1.5 font-extrabold text-grow-600">desc</span>
                        )}
                        {((mapping.amountMode === "single" && h === mapping.amountCol) ||
                          (mapping.amountMode === "debit_credit" && (h === mapping.debitCol || h === mapping.creditCol))) && (
                          <span className="ml-1 rounded-full bg-spark-100 px-1.5 font-extrabold text-spark-600">amount</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className="border-t border-cream-100">
                      {headers.map((h) => (
                        <td key={h} className="max-w-56 truncate whitespace-nowrap px-3 py-1.5 font-medium text-ink-600">
                          {String(r[h] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t-2 border-cream-100 p-3">
              {importing ? (
                <Spinner label={`Importing ${rows.length} rows…`} />
              ) : (
                <motion.button whileTap={{ scale: 0.96 }} type="button" onClick={runImport} className="btn-primary">
                  🚀 Import {rows.length} row{rows.length === 1 ? "" : "s"}
                </motion.button>
              )}
            </div>
          </Card>
          </Reveal>
        </>
      ) : (
        !rawText.trim() && (
          <EmptyState
            icon="🏦"
            title="Your bank's CSV goes here"
            hint="Grab an export from your online banking, drop it in above, and we'll sort out the rest together."
          />
        )
      )}
    </div>
  );
}

/** Post-import celebration screen — confetti when rows actually landed. */
function ImportSummary({
  summary,
  onImported,
  onReset,
}: {
  summary: Summary;
  onImported: (categorizeNow: boolean) => void;
  onReset: () => void;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (summary.imported > 0 && !fired.current) {
      fired.current = true;
      celebrate();
    }
  }, [summary.imported]);

  return (
    <Card>
      <div className="flex items-center gap-3">
        <motion.div
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 14 }}
          className={`grid h-14 w-14 place-items-center rounded-full text-3xl ${
            summary.imported > 0 ? "bg-grow-50" : "bg-honey-50"
          }`}
          aria-hidden
        >
          {summary.imported > 0 ? "✅" : "🤷"}
        </motion.div>
        <div>
          <h2 className="text-lg font-extrabold text-ink-900">
            {summary.imported > 0
              ? `Woohoo — ${summary.imported} transaction${summary.imported === 1 ? "" : "s"} in!`
              : "Nothing made it in this time"}
          </h2>
          <p className="text-sm font-bold text-ink-400">
            {summary.imported} imported · {summary.skipped.length} skipped
          </p>
        </div>
      </div>

      {summary.duplicates.length > 0 && (
        <div className="mt-4 rounded-2xl border-2 border-honey-200 bg-honey-50 p-3 text-sm font-medium text-honey-700">
          👯 {summary.duplicates.length} row{summary.duplicates.length === 1 ? " looks" : "s look"} like possible
          duplicates (same date, amount, and merchant). We imported them anyway — review and delete on the dashboard if
          they're doubles:
          <ul className="mt-1 list-disc pl-5">
            {summary.duplicates.slice(0, 10).map((d) => (
              <li key={d.row}>
                row {d.row}: {d.description}
              </li>
            ))}
            {summary.duplicates.length > 10 && <li>…and {summary.duplicates.length - 10} more</li>}
          </ul>
        </div>
      )}
      {summary.skipped.length > 0 && (
        <div className="mt-3 rounded-2xl border-2 border-cream-200 bg-cream-50 p-3 text-sm font-medium text-ink-600">
          Rows we had to skip:
          <ul className="mt-1 list-disc pl-5">
            {summary.skipped.slice(0, 20).map((s) => (
              <li key={`${s.row}-${s.reason}`}>
                row {s.row}: {s.reason}
              </li>
            ))}
            {summary.skipped.length > 20 && <li>…and {summary.skipped.length - 20} more</li>}
          </ul>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {summary.imported > 0 && (
          <motion.button whileTap={{ scale: 0.95 }} type="button" onClick={() => onImported(true)} className="btn-spark">
            ✨ Auto-label them now
          </motion.button>
        )}
        <button type="button" onClick={() => onImported(false)} className="btn-ghost">
          Go to dashboard
        </button>
        <button
          type="button"
          onClick={onReset}
          className="rounded-2xl px-4 py-2 text-sm font-bold text-ink-400 transition-colors hover:bg-cream-100 hover:text-ink-600"
        >
          Import another file
        </button>
      </div>
    </Card>
  );
}
