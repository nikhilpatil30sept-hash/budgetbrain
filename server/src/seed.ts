/**
 * Development seed: ~100 realistic transactions over the trailing ~5 months.
 * Run with `npm run seed` (from the repo root). Wipes existing transactions.
 *
 * Recent expenses (last ~12 days) are left Uncategorized on purpose so the
 * "Categorize" button has something to do out of the box.
 */
import { db } from "./db.js";
import { addDaysISO, nowISO, todayISO } from "./lib/dates.js";
import { recomputeFlags } from "./services/anomaly.js";

// Deterministic RNG so reseeding produces the same data.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260711);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const between = (min: number, max: number) => Math.round(min + rand() * (max - min));

const today = todayISO();
const start = addDaysISO(today, -150);

interface Tx {
  date: string;
  description: string;
  amount_cents: number;
  category: string;
}
const txs: Tx[] = [];
const add = (date: string, description: string, amount_cents: number, category: string) => {
  if (date >= start && date <= today) txs.push({ date, description, amount_cents, category });
};

// Income: biweekly payroll (~$2,400 net per check ≈ $5,200/mo gross-ish)
for (let d = addDaysISO(start, 3); d <= today; d = addDaysISO(d, 14)) {
  add(d, "PAYROLL DEPOSIT - ACME CORP", 240000, "Income");
}

// Monthly fixed bills on stable days
for (let m = 0; m < 7; m++) {
  const base = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
  base.setUTCMonth(base.getUTCMonth() + m);
  const ym = base.toISOString().slice(0, 7);
  add(`${ym}-01`, "RENT PAYMENT - OAKWOOD APTS", -145000, "Rent/Mortgage");
  add(`${ym}-05`, "CITY POWER & LIGHT UTIL", -between(7500, 13500), "Utilities");
  add(`${ym}-08`, "COMCAST XFINITY INTERNET", -7999, "Utilities");
  add(`${ym}-12`, "NETFLIX.COM", -1549, "Subscriptions");
  add(`${ym}-15`, "SPOTIFY USA", -1099, "Subscriptions");
  add(`${ym}-20`, "CITY GYM MEMBERSHIP", -4500, "Health");
}

// Weekly-ish variable spending
const groceries = ["WALMART #4521", "TRADER JOE'S #552", "KROGER #718", "COSTCO WHSE #1123"];
const dining = [
  "CHIPOTLE 2214",
  "STARBUCKS STORE 08812",
  "DOORDASH*THAI HOUSE",
  "MCDONALD'S F32144",
  "SQ *BLUE BOTTLE COFFEE",
];
const transport = ["UBER *TRIP", "SHELL OIL 57444621", "CITY METRO FARE"];
const shopping = ["AMZN MKTP US*2Y4AB78", "TARGET 00021456"];
for (let d = start; d <= today; d = addDaysISO(d, 7)) {
  add(addDaysISO(d, between(0, 2)), pick(groceries), -between(4200, 12800), "Groceries");
  add(addDaysISO(d, between(1, 4)), pick(dining), -between(900, 4800), "Dining");
  if (rand() < 0.45) add(addDaysISO(d, between(0, 6)), pick(transport), -between(800, 5200), "Transport");
  if (rand() < 0.3) add(addDaysISO(d, between(0, 6)), pick(shopping), -between(1500, 9800), "Shopping");
}

// Occasional one-offs
add(addDaysISO(today, -95), "DELTA AIR 0062341987", -32450, "Travel");
add(addDaysISO(today, -93), "AIRBNB HMQ8XR2T9", -28500, "Travel");
add(addDaysISO(today, -60), "CVS/PHARMACY #8722", -3465, "Health");
add(addDaysISO(today, -34), "AMC THEATRES 0442", -3250, "Entertainment");
add(addDaysISO(today, -20), "STEAMGAMES.COM 425952", -2999, "Entertainment");
add(addDaysISO(today, -75), "MONTHLY SERVICE FEE", -1200, "Fees");
add(addDaysISO(today, -45), "ATM WITHDRAWAL FEE", -350, "Fees");
add(addDaysISO(today, -50), "TRANSFER TO SAVINGS", -50000, "Transfers");
add(addDaysISO(today, -22), "TRANSFER TO SAVINGS", -50000, "Transfers");

// Two anomalies for the flag demo:
//  - a dinner far above the Dining median (3× median rule)
//  - a purchase over 30% of the seeded $5,200 monthly income
add(addDaysISO(today, -25), "LE BERNARDIN NYC", -85000, "Dining");
add(addDaysISO(today, -8), "APPLE STORE R123 MACBOOK", -179900, "Shopping");

// Leave recent *variable* spending Uncategorized so AI categorization has
// work to do (fixed bills stay labeled so the current-month pie isn't empty).
const uncatCutoff = addDaysISO(today, -21);
const variable = new Set(["Groceries", "Dining", "Transport", "Shopping", "Entertainment", "Health"]);
for (const t of txs) {
  if (t.date >= uncatCutoff && t.amount_cents < 0 && variable.has(t.category)) {
    t.category = "Uncategorized";
  }
}

txs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

db.transaction(() => {
  db.prepare("DELETE FROM transactions").run();
  db.prepare("DELETE FROM merchant_category_cache").run();
  db.prepare("DELETE FROM suggestions_cache").run();
  db.prepare("UPDATE settings SET value = '520000' WHERE key = 'monthly_income_cents'").run();

  const insert = db.prepare(
    `INSERT INTO transactions (date, description, amount_cents, category, category_source, created_at)
     VALUES (?, ?, ?, ?, 'manual', ?)`
  );
  for (const t of txs) {
    insert.run(t.date, t.description, t.amount_cents, t.category, nowISO());
  }
})();

const { flagged_count } = recomputeFlags();
const uncat = txs.filter((t) => t.category === "Uncategorized").length;
console.log(
  `Seeded ${txs.length} transactions (${uncat} left Uncategorized for the AI demo), ` +
    `monthly income set to $5,200.00, ${flagged_count} transaction(s) flagged.`
);
