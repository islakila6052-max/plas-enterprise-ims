// src/components/journal/JournalPagination.jsx
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/utils/cn";

/** Page numbers shown either side of the current page. */
const SIBLINGS = 1;

/**
 * Build a compact page list: always 1 and the last page, the current page, and
 * its immediate neighbours. Gaps become an ellipsis. Keeps the control short
 * enough to sit on one row on a phone without scrolling.
 *
 * e.g. [1, '…', 4, 5, 6, '…', 12]
 */
function buildPages(current, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages = new Set([1, totalPages, current]);
  for (let i = 1; i <= SIBLINGS; i += 1) {
    if (current - i > 1) pages.add(current - i);
    if (current + i < totalPages) pages.add(current + i);
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push("gap");
    out.push(p);
    prev = p;
  }
  return out;
}

/**
 * Pagination for the intern journal list.
 *
 * Page numbers are wrapped so they stay on one line and scroll horizontally on
 * very narrow screens rather than wrapping and breaking the card's layout.
 * Buttons are sized for touch (36px) and the current page is marked with
 * aria-current so screen readers announce the position.
 */
export default function JournalPagination({ page, totalItems, pageSize, onPageChange }) {
  const size = pageSize > 0 ? pageSize : 5;
  const totalItemsSafe = Number(totalItems) || 0;
  const totalPages = Math.max(1, Math.ceil(totalItemsSafe / size));
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);

  const first = totalItemsSafe === 0 ? 0 : (safePage - 1) * size + 1;
  const last = Math.min(safePage * size, totalItemsSafe);

  const go = (next) => {
    const target = Math.min(Math.max(1, next), totalPages);
    if (target !== safePage) onPageChange(target);
  };

  const baseBtn =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500";

  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-slate-500">
        {totalItemsSafe === 0 ? (
          "No entries"
        ) : (
          <>
            Showing <span className="font-medium text-slate-700">{first}</span>–
            <span className="font-medium text-slate-700">{last}</span> of{" "}
            <span className="font-medium text-slate-700">{totalItemsSafe}</span>{" "}
            journal{totalItemsSafe === 1 ? "" : "s"}
          </>
        )}
      </p>

      {totalPages > 1 && (
        <nav
          aria-label="Journal pages"
          className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1 sm:overflow-visible sm:pb-0">
          <button
            type="button"
            onClick={() => go(safePage - 1)}
            disabled={safePage <= 1}
            aria-label="Previous page"
            className={cn(
              baseBtn,
              "gap-1 border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40",
            )}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Prev</span>
          </button>

          {buildPages(safePage, totalPages).map((p, i) =>
            p === "gap" ? (
              <span
                key={`gap-${i}`}
                aria-hidden
                className="px-1 text-sm leading-none text-slate-300">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => go(p)}
                aria-current={p === safePage ? "page" : undefined}
                aria-label={`Page ${p}`}
                className={cn(
                  baseBtn,
                  p === safePage
                    ? "bg-brand-600 text-white shadow-sm"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                )}>
                {p}
              </button>
            ),
          )}

          <button
            type="button"
            onClick={() => go(safePage + 1)}
            disabled={safePage >= totalPages}
            aria-label="Next page"
            className={cn(
              baseBtn,
              "gap-1 border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40",
            )}>
            <span className="hidden sm:inline">Next</span>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </nav>
      )}
    </div>
  );
}
