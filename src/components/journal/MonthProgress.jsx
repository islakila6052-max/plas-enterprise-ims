// src/components/journal/MonthProgress.jsx
import { useMemo } from "react";
import { todayISO } from "@/utils/format";
import { cn } from "@/utils/cn";

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_INITIALS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/* ---------------------------------------------------------------------------
 * The garden metaphor
 *
 * A journal month is a garden plot, and every entry is growth:
 *
 *   approved  -> a bloom     (the goal: reviewed and signed off)
 *   pending   -> a seedling  (growing, waiting on a supervisor)
 *   rejected  -> a seed      (needs another try)
 *   no entry  -> bare soil   (room to plant something)
 *
 * The information design is deliberately unchanged: the day number is always
 * the dominant element and status is never carried by colour alone, so the
 * whimsy never costs legibility or accessibility.
 * ------------------------------------------------------------------------ */

/** A two-leaf sprout: documented, awaiting review. */
function Seedling({ className }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden focusable="false">
      <path d="M8 14.5V7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 8.5C8 5.2 6 4 3.2 4 3.2 7.6 5.4 8.6 8 8.5Z" fill="currentColor" opacity=".9" />
      <path d="M8 8.5c0-2.9 1.8-4 4-4 0 3.2-1.9 4.1-4 4Z" fill="currentColor" opacity=".5" />
    </svg>
  );
}

/** A full flower: documented and approved. */
function Bloom({ className }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden focusable="false">
      <path d="M8 15.5v-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M8 12.2c-2.2 0-3.3-1.1-3.5-2.8 2-.5 3.1.7 3.5 1.4.4-.7 1.5-1.9 3.5-1.4-.2 1.7-1.3 2.8-3.5 2.8Z"
        fill="currentColor"
        opacity=".65"
      />
      <g fill="currentColor">
        <circle cx="8" cy="4.9" r="2.1" />
        <circle cx="8" cy="1.9" r="1.65" opacity=".7" />
        <circle cx="11" cy="3.4" r="1.65" opacity=".7" />
        <circle cx="10.3" cy="6" r="1.65" opacity=".7" />
        <circle cx="5.7" cy="6" r="1.65" opacity=".7" />
        <circle cx="5" cy="3.4" r="1.65" opacity=".7" />
      </g>
    </svg>
  );
}

/** A seed that never sprouted: the entry was rejected. */
function Seed({ className }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden focusable="false">
      <path
        d="M1.8 13.4c2.6 1.2 9.8 1.2 12.4 0"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
        opacity=".45"
      />
      <ellipse cx="8" cy="7.6" rx="2.7" ry="3.4" fill="currentColor" opacity=".8" />
    </svg>
  );
}

/** Bare, dashed soil: a past day with nothing documented. */
function Soil({ className }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden focusable="false">
      <circle
        cx="8"
        cy="8"
        r="4.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeDasharray="2.2 2.2"
        opacity=".6"
      />
    </svg>
  );
}

/** Faint leaf-vein motif in the header corner. Decorative only. */
function LeafWash() {
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 120 80"
      className="pointer-events-none absolute -right-6 -top-8 h-24 w-36 text-brand-300/50"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2">
      <path d="M8 74C34 58 62 34 104 6" />
      <path d="M30 62c-4-10-2-18 4-24 6 8 5 17-4 24Z" fill="currentColor" fillOpacity=".5" />
      <path d="M52 46c-3-10 0-18 7-23 5 9 3 18-7 23Z" fill="currentColor" fillOpacity=".4" />
      <path d="M74 30c-2-9 2-16 9-20 3 9 0 17-9 20Z" fill="currentColor" fillOpacity=".3" />
      <path d="M40 56c8-2 14-8 16-16" />
    </svg>
  );
}

const PLANT = { approved: Bloom, pending: Seedling, rejected: Seed };

// When a day has several entries, show the most settled one.
const STATUS_RANK = { approved: 0, pending: 1, rejected: 2 };

const STATUS_TEXT = {
  approved: "approved",
  pending: "pending review",
  rejected: "rejected",
};

// A little encouragement, because a bare calendar is demoralising.
const GROWTH_COPY = [
  { min: 100, label: "Full bloom", note: "Every elapsed day documented." },
  { min: 70, label: "Flourishing", note: "Nearly the whole month is in bloom." },
  { min: 40, label: "Taking root", note: "Steady progress this month." },
  { min: 1, label: "Seedling season", note: "Keep documenting, it is growing." },
  { min: 0, label: "Bare soil", note: "Nothing documented this month yet." },
];

/**
 * Month calendar showing which days were documented, drawn as a small garden.
 *
 * Kept deliberately compact for a narrow sidebar column, and deliberately
 * plain in its information design: the day number is always the dominant
 * element and status is never carried by colour alone, so it reads as a record
 * first and a garden second.
 *
 * Days are keyboard-reachable buttons with descriptive labels, so the compact
 * presentation stays usable with a screen reader.
 */
export default function MonthProgress({
  rows = [],
  onSelectDay,
  title = "Journal Garden",
}) {
  const today = todayISO();

  const { monthLabel, cells, documentedCount, elapsedDays, pendingCount } =
    useMemo(() => {
      const [y, m] = today.split("-").map(Number);
      const monthIndex = m - 1;

      // date -> { journal, count }. Days with several entries collapse into one
      // cell, keeping the most settled status so a day is not downgraded just
      // because an earlier entry was still pending.
      const byDate = new Map();
      for (const r of rows) {
        const key = String(r?.date ?? "").slice(0, 10);
        if (!key) continue;
        const prev = byDate.get(key);
        if (!prev) {
          byDate.set(key, { journal: r, count: 1 });
          continue;
        }
        prev.count += 1;
        const incoming = STATUS_RANK[r.status] ?? 3;
        const current = STATUS_RANK[prev.journal.status] ?? 3;
        if (incoming < current) prev.journal = r;
      }

      const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
      // getUTCDay is 0=Sunday, which matches the weekday header order above.
      const leadingBlanks = new Date(Date.UTC(y, monthIndex, 1)).getUTCDay();

      const grid = [];
      for (let i = 0; i < leadingBlanks; i += 1) grid.push(null);
      for (let d = 1; d <= daysInMonth; d += 1) {
        const key = new Date(Date.UTC(y, monthIndex, d))
          .toISOString()
          .slice(0, 10);
        grid.push({
          key,
          day: d,
          ...(byDate.get(key) ?? { journal: null, count: 0 }),
          isToday: key === today,
          isFuture: key > today,
        });
      }

      return {
        // Short label keeps the header to one line in a narrow column.
        monthLabel: `${MONTH_INITIALS[monthIndex]} ${y}`,
        cells: grid,
        documentedCount: grid.filter((c) => c?.journal).length,
        pendingCount: grid.filter(
          (c) => c?.journal?.status === "pending",
        ).length,
        elapsedDays: grid.filter((c) => c && !c.isFuture).length,
      };
    }, [rows, today]);

  const percent =
    elapsedDays > 0 ? Math.round((documentedCount / elapsedDays) * 100) : 0;
  const growth = GROWTH_COPY.find((g) => percent >= g.min);

  return (
    <section
      className="overflow-hidden rounded-xl border border-brand-200 bg-white shadow-sm"
      aria-label={`Monthly journal progress for ${monthLabel}`}>
      {/* Header: a soft leaf-vein wash, so the panel gets its own little
          terrace without needing an image asset. */}
      <div className="relative overflow-hidden bg-gradient-to-br from-brand-100 via-brand-50 to-white px-4 pb-3 pt-3.5">
        <LeafWash />
        <div className="relative flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-brand-600/80">
              {title}
            </p>
            <h3 className="mt-0.5 text-base font-bold leading-tight text-brand-900">
              {monthLabel}
            </h3>
            <p className="mt-1 text-[11px] leading-tight text-brand-700/80">
              <span className="font-semibold text-brand-800">
                {growth.label}
              </span>
              {" · "}
              {growth.note}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-lg font-bold leading-none tabular-nums text-brand-700">
              {percent}
              <span className="text-[11px] font-semibold">%</span>
            </p>
            <p className="mt-1 text-[10px] tabular-nums text-brand-600/80">
              {documentedCount}/{elapsedDays} days
            </p>
          </div>
        </div>

        {/* The growth bar: the one figure the strip summarises. */}
        <div
          className="relative mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-brand-100"
          role="img"
          aria-label={`${percent}% of elapsed days documented`}>
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-300 via-brand-400 to-brand-600 transition-[width] duration-500 ease-out"
            // A visible stub at low percentages so "1 of 30" never looks empty.
            style={{ width: `${percent > 0 ? Math.max(percent, 7) : 0}%` }}
          />
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-0.5 px-2.5 pt-2.5">
        {WEEKDAY_INITIALS.map((w, i) => (
          <span
            key={`${w}-${i}`}
            aria-hidden
            className="pb-1 text-center text-[9px] font-semibold uppercase leading-none tracking-wide text-brand-400">
            {w}
          </span>
        ))}
      </div>

      {/* The plots */}
      <div className="grid grid-cols-7 gap-0.5 px-2.5 pb-2.5">
        {cells.map((cell, i) => {
          if (!cell) return <span key={`blank-${i}`} aria-hidden />;

          const { journal, isToday, isFuture } = cell;
          const status = journal?.status;
          const Plant = status ? PLANT[status] : null;

          const cls = cn(
            "flex aspect-square w-full flex-col items-center",
            "justify-center gap-0.5 rounded-lg py-0.5 transition",
            journal ? "cursor-pointer" : "cursor-default",
            // The soil each plot sits in.
            journal
              ? status === "approved"
                ? "bg-brand-100/80"
                : status === "pending"
                  ? "bg-brand-50"
                  : "bg-rose-50"
              : isFuture
                ? "bg-transparent"
                : "bg-slate-50/70",
            journal && "hover:brightness-[0.97]",
            isToday && "ring-2 ring-brand-500 ring-offset-1",
          );

          if (!journal) {
            return (
              <span
                key={cell.key}
                aria-hidden
                title={
                  isFuture
                    ? `Day ${cell.day} — upcoming`
                    : `Day ${cell.day} — nothing documented`
                }
                className={cls}>
                <span
                  className={cn(
                    "text-[10px] font-semibold leading-none tabular-nums",
                    isFuture ? "text-slate-300" : "text-slate-400",
                  )}>
                  {cell.day}
                </span>
                {!isFuture && <Soil className="h-2 w-2 text-slate-300" />}
              </span>
            );
          }

          return (
            <button
              key={cell.key}
              type="button"
              onClick={() => onSelectDay?.(journal)}
              title={`Day ${cell.day}: ${STATUS_TEXT[status] ?? status}`}
              aria-label={`Day ${cell.day}: documented, ${STATUS_TEXT[status] ?? status}`}
              className={cn(
                cls,
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-600",
              )}>
              <span className="text-[10px] font-bold leading-none tabular-nums text-brand-900">
                {cell.day}
              </span>
              {Plant &&
                (status === "approved" ? (
                  <Plant className="h-3 w-3 text-brand-600" />
                ) : status === "pending" ? (
                  <Plant className="h-2.5 w-2.5 text-brand-500" />
                ) : (
                  <Plant className="h-2.5 w-2.5 text-rose-400" />
                ))}
            </button>
          );
        })}
      </div>

      {/* Legend - labelled in words, so it never depends on the artwork. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-brand-100 bg-brand-50/50 px-3 py-2 text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          <Bloom className="h-2.5 w-2.5 text-brand-600" />
          Approved
        </span>
        <span className="flex items-center gap-1">
          <Seedling className="h-2.5 w-2.5 text-brand-500" />
          Pending{pendingCount > 0 ? ` (${pendingCount})` : ""}
        </span>
        <span className="flex items-center gap-1">
          <Seed className="h-2.5 w-2.5 text-rose-400" />
          Rejected
        </span>
      </div>
    </section>
  );
}

