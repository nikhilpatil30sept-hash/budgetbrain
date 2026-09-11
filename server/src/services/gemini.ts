import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname, "..", "..", "logs");

export type GeminiErrorKind = "no_key" | "rate_limit" | "server" | "http" | "network";

export class GeminiError extends Error {
  constructor(
    message: string,
    public kind: GeminiErrorKind,
    public status?: number
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

/**
 * Append a JSON line per API call to a local log file (requirements 5.3).
 * The API key is never logged.
 */
function logApiCall(entry: Record<string, unknown>) {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    const file = path.join(LOGS_DIR, "gemini.log");
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch {
    // Logging must never take down a categorization run.
  }
}

export function hasApiKey(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key !== "your_key_here");
}

/** One raw Gemini call. Throws typed GeminiError on any failure. */
export async function callGemini(prompt: string, label: string, batchSize: number): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === "your_key_here") {
    logApiCall({ label, batchSize, outcome: "no_key" });
    throw new GeminiError(
      "GEMINI_API_KEY is not set. Add it to server/.env (see server/.env.example).",
      "no_key"
    );
  }
  // gemini-flash-latest started returning sustained 503s ("high demand") in
  // Sept 2026 — Google had moved the model generation on to gemini-3.x and
  // the "latest" alias was left pointing at an overloaded/legacy target.
  // gemini-3.5-flash-lite is confirmed working as of the same date, including
  // for large prompts; gemini-2.0-flash was moved off the free tier earlier
  // (free-tier request limit is now 0), so it 429s. If this breaks again,
  // check https://ai.google.dev/gemini-api/docs/models for current names.
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    });
  } catch (e) {
    logApiCall({ label, batchSize, outcome: "network_error", detail: String(e) });
    throw new GeminiError("Network error calling Gemini", "network");
  }

  if (res.status === 429) {
    logApiCall({ label, batchSize, outcome: "rate_limited", status: 429 });
    throw new GeminiError("Gemini rate limit hit (429)", "rate_limit", 429);
  }
  if (res.status >= 500) {
    logApiCall({ label, batchSize, outcome: "server_error", status: res.status });
    throw new GeminiError(`Gemini server error (${res.status})`, "server", res.status);
  }
  if (!res.ok) {
    logApiCall({ label, batchSize, outcome: "http_error", status: res.status });
    throw new GeminiError(
      `Gemini request failed (${res.status}) — check that your API key is valid`,
      "http",
      res.status
    );
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("");
  logApiCall({ label, batchSize, outcome: "ok", status: res.status, responseChars: text.length });
  return text;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Rate-limit/5xx handling per requirements 5.3: on 429 or 5xx wait 15s, then
 * 30s — max 3 attempts total — then rethrow so the caller can skip remaining
 * work. Other error kinds are not retried here.
 */
export async function callGeminiWithBackoff(
  prompt: string,
  label: string,
  batchSize: number
): Promise<string> {
  const waits = [15_000, 30_000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await callGemini(prompt, label, batchSize);
    } catch (e) {
      const retryable = e instanceof GeminiError && (e.kind === "rate_limit" || e.kind === "server");
      if (!retryable || attempt >= waits.length) throw e;
      await sleep(waits[attempt]);
    }
  }
}

/** Strip markdown code fences the model may add despite instructions. */
export function stripFences(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

/**
 * Defensive JSON-array extraction: strip fences, then parse; if that fails,
 * try the substring between the first '[' and the last ']'.
 */
export function parseJsonArrayLoose(text: string): unknown[] {
  const cleaned = stripFences(text);
  try {
    const v = JSON.parse(cleaned);
    if (Array.isArray(v)) return v;
  } catch {
    // fall through to bracket extraction
  }
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start !== -1 && end > start) {
    const v = JSON.parse(cleaned.slice(start, end + 1));
    if (Array.isArray(v)) return v;
  }
  throw new Error("Response was not a JSON array");
}
