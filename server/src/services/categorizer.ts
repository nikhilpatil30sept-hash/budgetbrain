import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { CATEGORIES, isCategory } from "../lib/categories.js";
import { merchantKey } from "../lib/normalize.js";
import { recomputeFlags } from "./anomaly.js";
import { callGeminiWithBackoff, GeminiError, parseJsonArrayLoose } from "./gemini.js";

const BATCH_SIZE = 40; // max descriptions per API call (requirements 5.1)
const BATCH_DELAY_MS = 5_000; // stay under the free tier's 15 RPM

export interface RunStatus {
  run_id: string | null;
  status: "idle" | "running" | "done";
  total_transactions: number;
  cached_count: number;
  ai_count: number;
  fallback_count: number;
  batches_total: number;
  batches_done: number;
  batches_skipped: number;
  errors: string[];
  started_at: string | null;
  finished_at: string | null;
}

let run: RunStatus = {
  run_id: null,
  status: "idle",
  total_transactions: 0,
  cached_count: 0,
  ai_count: 0,
  fallback_count: 0,
  batches_total: 0,
  batches_done: 0,
  batches_skipped: 0,
  errors: [],
  started_at: null,
  finished_at: null,
};

export function getRunStatus(): RunStatus {
  return run;
}

interface BatchItem {
  key: string;
  sampleDescription: string;
  txIds: number[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const assignStmt = () =>
  db.prepare("UPDATE transactions SET category = ?, category_source = ? WHERE id = ?");

function writeCache(key: string, category: string) {
  db.prepare(
    `INSERT INTO merchant_category_cache (merchant_key, category, hit_count)
     VALUES (?, ?, 0)
     ON CONFLICT(merchant_key) DO UPDATE SET category = excluded.category`
  ).run(key, category);
}

function buildPrompt(items: BatchItem[]): string {
  const list = CATEGORIES.filter((c) => c !== "Uncategorized").join(", ");
  const lines = items.map((it, i) => `${i}: ${it.sampleDescription}`).join("\n");
  return [
    "You categorize bank transaction descriptions.",
    `Allowed categories (use these EXACT strings): ${list}`,
    'Respond with ONLY a JSON array, no markdown fences, no commentary.',
    'Shape: [{"i": <index>, "category": "<one of the allowed categories>"}] with one entry per input line.',
    "",
    "Examples:",
    'Input: 0: NETFLIX.COM  →  [{"i":0,"category":"Subscriptions"}]',
    'Input: 0: UBER *TRIP  →  [{"i":0,"category":"Transport"}]',
    'Input: 0: PAYROLL DEPOSIT  →  [{"i":0,"category":"Income"}]',
    "",
    "Transactions to categorize:",
    lines,
  ].join("\n");
}

/**
 * Parse a batch response defensively (requirements 5.3): fences stripped,
 * unknown categories mapped to Other, malformed entries ignored.
 */
function parseBatchResponse(text: string, itemCount: number): Map<number, string> {
  const arr = parseJsonArrayLoose(text);
  const out = new Map<number, string>();
  for (const entry of arr) {
    if (typeof entry !== "object" || entry === null) continue;
    const { i, category } = entry as { i?: unknown; category?: unknown };
    if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= itemCount) continue;
    if (typeof category !== "string") continue;
    out.set(i, isCategory(category) && category !== "Uncategorized" ? category : "Other");
  }
  if (out.size === 0) throw new Error("No usable entries in response");
  return out;
}

/**
 * Kick off a categorization run over all Uncategorized transactions.
 * Returns the run id immediately; work continues in the background and is
 * observable via getRunStatus(). Only one run at a time.
 */
export function startCategorization(): { run_id: string } | { error: string } {
  if (run.status === "running") return { error: "A categorization run is already in progress" };

  const uncategorized = db
    .prepare("SELECT id, description FROM transactions WHERE category = 'Uncategorized'")
    .all() as { id: number; description: string }[];

  const runId = randomUUID();
  run = {
    run_id: runId,
    status: "running",
    total_transactions: uncategorized.length,
    cached_count: 0,
    ai_count: 0,
    fallback_count: 0,
    batches_total: 0,
    batches_done: 0,
    batches_skipped: 0,
    errors: [],
    started_at: new Date().toISOString(),
    finished_at: null,
  };

  // Pass 1 — merchant cache. No API call for anything we've seen before.
  const cacheGet = db.prepare(
    "SELECT category FROM merchant_category_cache WHERE merchant_key = ?"
  );
  const cacheHit = db.prepare(
    "UPDATE merchant_category_cache SET hit_count = hit_count + 1 WHERE merchant_key = ?"
  );
  const assign = assignStmt();
  const pending = new Map<string, BatchItem>();

  db.transaction(() => {
    for (const tx of uncategorized) {
      const key = merchantKey(tx.description);
      if (!key) {
        run.fallback_count++;
        continue;
      }
      const hit = cacheGet.get(key) as { category: string } | undefined;
      if (hit) {
        assign.run(hit.category, "cache", tx.id);
        cacheHit.run(key);
        run.cached_count++;
      } else {
        // Deduplicate identical merchant keys so one API answer covers all
        // matching transactions.
        const item = pending.get(key);
        if (item) item.txIds.push(tx.id);
        else pending.set(key, { key, sampleDescription: tx.description, txIds: [tx.id] });
      }
    }
  })();

  const items = [...pending.values()];
  const batches: BatchItem[][] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    batches.push(items.slice(i, i + BATCH_SIZE));
  }
  run.batches_total = batches.length;

  if (batches.length === 0) {
    recomputeFlags();
    run.status = "done";
    run.finished_at = new Date().toISOString();
    return { run_id: runId };
  }

  void processBatches(batches);
  return { run_id: runId };
}

async function processBatches(batches: BatchItem[][]) {
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    try {
      const results = await categorizeBatch(batch, b + 1);
      const assign = assignStmt();
      db.transaction(() => {
        batch.forEach((item, idx) => {
          const category = results.get(idx);
          if (category) {
            for (const id of item.txIds) assign.run(category, "ai", id);
            writeCache(item.key, category);
            run.ai_count += item.txIds.length;
          } else {
            // Model skipped this line — leave Uncategorized for a later run.
            run.fallback_count += item.txIds.length;
          }
        });
      })();
      run.batches_done++;
    } catch (e) {
      if (e instanceof GeminiError && (e.kind === "rate_limit" || e.kind === "server")) {
        // Backoff already exhausted — skip everything left and let the user
        // re-run later (requirements 5.3).
        run.batches_skipped = batches.length - b;
        run.errors.push(
          `${e.message} after retries — ${run.batches_skipped} batch(es) skipped. Re-run categorization later; cached merchants won't cost API calls.`
        );
        break;
      }
      if (e instanceof GeminiError && (e.kind === "no_key" || e.kind === "http" || e.kind === "network")) {
        run.batches_skipped = batches.length - b;
        run.errors.push(
          e.kind === "no_key" || e.status === 400 || e.status === 403
            ? "Gemini API key missing or invalid — transactions were left as Uncategorized. Add a valid key to server/.env and re-run."
            : `${e.message} — remaining batches skipped.`
        );
        break;
      }
      // Parse failures for a single batch: fall back, keep going.
      run.fallback_count += batch.reduce((n, it) => n + it.txIds.length, 0);
      run.errors.push(`Batch ${b + 1}: unparseable response after retry — left as Uncategorized.`);
      run.batches_done++;
    }
    if (b < batches.length - 1) await sleep(BATCH_DELAY_MS);
  }

  try {
    recomputeFlags();
  } catch (e) {
    run.errors.push(`Anomaly recompute failed: ${String(e)}`);
  }
  run.status = "done";
  run.finished_at = new Date().toISOString();
}

/** One Gemini call for a batch; on a parse failure, retry the batch once. */
async function categorizeBatch(batch: BatchItem[], batchNumber: number): Promise<Map<number, string>> {
  const prompt = buildPrompt(batch);
  const label = `categorize-batch-${batchNumber}`;
  const first = await callGeminiWithBackoff(prompt, label, batch.length);
  try {
    return parseBatchResponse(first, batch.length);
  } catch {
    const second = await callGeminiWithBackoff(prompt, `${label}-retry`, batch.length);
    return parseBatchResponse(second, batch.length); // throws → caller falls back
  }
}
