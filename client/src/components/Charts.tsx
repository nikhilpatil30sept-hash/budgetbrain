import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { motion } from "framer-motion";
import { categoryColor, categoryIcon } from "../lib/categories";
import { formatCents, formatCentsCompact } from "../lib/money";
import { EmptyState } from "./Bits";

// Kept in sync with tailwind.config.js's ink.400 -- recharts tick colors
// are plain hex, not Tailwind classes, so this can't just apply the utility
// class (darkened for WCAG AA contrast; see the config file's comment).
const INK_MUTED = "#766960";
const GRID = "#F3E9D9";
const BAR_LATEST = "#FF6B35";
const BAR_REST = "#FFC7B0";

function ChartTooltip({
  active,
  payload,
  symbol,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; payload?: { name?: string; month?: string; label?: string } }[];
  symbol: string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const label = p.payload?.name ?? p.payload?.label ?? p.name;
  const icon = p.payload?.name ? categoryIcon(p.payload.name) : "💸";
  return (
    <div className="rounded-2xl border-2 border-cream-200 bg-white px-3 py-2 text-sm shadow-lift">
      <span aria-hidden>{icon}</span>
      <span className="ml-1.5 font-extrabold text-ink-900">{label}</span>
      <span className="ml-2 font-bold tabular-nums text-ink-600">{formatCents(p.value ?? 0, symbol)}</span>
    </div>
  );
}

/**
 * Spending donut — every category keeps its own signature color (the same
 * one its badge wears), slices draw in on load, total sits in the middle.
 */
export function CategoryPie({
  data,
  symbol,
}: {
  data: { category: string; spent_cents: number }[];
  symbol: string;
}) {
  const slices = data.map((d) => ({ name: d.category, value: d.spent_cents }));

  if (slices.length === 0) {
    return (
      <EmptyState
        icon="🎨"
        title="Nothing to paint yet!"
        hint="Add or import some spending and this donut fills up with color."
      />
    );
  }

  const total = slices.reduce((s, d) => s + d.value, 0);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* aria-hidden: the <ul> of categories/amounts/percentages just below
          is a full, already-accessible text equivalent of this donut, so
          the chart itself is purely decorative to assistive tech. Without
          this, axe flags each pie slice (an unlabeled <path role="img">,
          courtesy of recharts) as inaccessible. */}
      <div className="relative h-60 w-60 shrink-0" aria-hidden="true">
        <ResponsiveContainer>
          {/* accessibilityLayer={false}: this whole chart is already
              aria-hidden (see the wrapping div above) since the category
              list next to it is the real accessible content. Without this,
              recharts still puts its own tabIndex=0 on the pie's <g>,
              which axe correctly flags -- a focusable element inside an
              aria-hidden container is a keyboard trap with nothing for a
              screen reader to announce when it lands there. */}
          <PieChart accessibilityLayer={false}>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              // accessibilityLayer={false} above stops the chart-level
              // keyboard-nav wiring, but Pie has its own separate
              // rootTabIndex prop (defaults to 0) that put tabindex="0" on
              // its <g> regardless -- that's what axe was actually still
              // catching. -1 takes it out of tab order to match the
              // aria-hidden container it lives in.
              rootTabIndex={-1}
              innerRadius={62}
              outerRadius={92}
              paddingAngle={2.5}
              cornerRadius={6}
              stroke="#ffffff"
              strokeWidth={2}
              isAnimationActive
              animationDuration={900}
              animationEasing="ease-out"
            >
              {slices.map((s) => (
                <Cell key={s.name} fill={categoryColor(s.name)} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip symbol={symbol} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[11px] font-extrabold uppercase tracking-wide text-ink-400">spent</span>
          <span className="text-lg font-extrabold tabular-nums text-ink-900">{formatCents(total, symbol)}</span>
        </div>
      </div>
      <ul className="min-w-44 flex-1 space-y-1 text-sm">
        {slices.map((s, i) => (
          <motion.li
            key={s.name}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.05 }}
            className="flex items-center gap-2 rounded-xl px-2 py-1 transition-colors hover:bg-cream-50"
          >
            <span aria-hidden>{categoryIcon(s.name)}</span>
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: categoryColor(s.name) }}
              aria-hidden
            />
            <span className="flex-1 truncate font-bold text-ink-600">{s.name}</span>
            <span className="font-extrabold tabular-nums text-ink-900">{formatCents(s.value, symbol)}</span>
            <span className="w-9 text-right text-xs font-bold tabular-nums text-ink-400">
              {total > 0 ? Math.round((s.value / total) * 100) : 0}%
            </span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

/** Last 6 months of spending — the current month pops in brand coral. */
export function SpendingBar({
  data,
  symbol,
}: {
  data: { month: string; spent_cents: number }[];
  symbol: string;
}) {
  if (data.every((d) => d.spent_cents === 0)) {
    return (
      <EmptyState
        icon="🏜️"
        title="No history here yet"
        hint="Import a CSV and watch six months of spending roll in."
      />
    );
  }
  const pretty = data.map((d, i) => ({
    ...d,
    label: new Date(`${d.month}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
    latest: i === data.length - 1,
  }));
  return (
    <div className="h-60">
      <ResponsiveContainer>
        <BarChart data={pretty} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: GRID, strokeWidth: 2 }}
            tick={{ fill: INK_MUTED, fontSize: 12, fontWeight: 700 }}
          />
          <YAxis
            tickFormatter={(v: number) => formatCentsCompact(v, symbol)}
            tickLine={false}
            axisLine={false}
            tick={{ fill: INK_MUTED, fontSize: 12, fontWeight: 700 }}
            width={48}
          />
          <Tooltip cursor={{ fill: "rgba(255,107,53,0.06)", radius: 12 }} content={<ChartTooltip symbol={symbol} />} />
          <Bar
            dataKey="spent_cents"
            radius={[10, 10, 4, 4]}
            maxBarSize={44}
            isAnimationActive
            animationDuration={800}
            animationEasing="ease-out"
          >
            {pretty.map((d) => (
              <Cell key={d.month} fill={d.latest ? BAR_LATEST : BAR_REST} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
