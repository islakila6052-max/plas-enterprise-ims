// src/components/announcements/LikersPopover.jsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Heart, ChevronLeft, ChevronRight } from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import Spinner from "@/components/ui/Spinner";
import { cn } from "@/utils/cn";
import { announcementService } from "@/services/announcementService";
import { formatDateTime } from "@/utils/format";

/** Likes shown per page inside the popover. */
const PAGE_SIZE = 10;

/**
 * "♥ N" trigger that reveals WHO liked an announcement.
 *
 * Opened by hovering (desktop), clicking (touch) or focusing (keyboard);
 * closed by moving away, clicking outside or pressing Escape. The list is
 * fetched lazily on first open and paginated, so an announcement with hundreds
 * of likes never loads them all at once.
 *
 * @param {string} announcementId
 * @param {number} count  Like total already known from the list query.
 */
export default function LikersPopover({ announcementId, count = 0, className = "" }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(count);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const wrapRef = useRef(null);
  const closeTimer = useRef(null);

  const totalPages = Math.max(1, Math.ceil((Number(total) || 0) / PAGE_SIZE));

  const fetchPage = useCallback(
    async (nextPage) => {
      setLoading(true);
      setError(null);
      try {
        const res = await announcementService.listLikes(announcementId, {
          page: nextPage,
          pageSize: PAGE_SIZE,
        });
        setRows(res.data ?? []);
        setTotal(res.count ?? 0);
        setPage(nextPage);
      } catch (err) {
        setError(err);
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [announcementId],
  );

  // (Re)load from page 1 each time the popover opens so the names stay fresh.
  useEffect(() => {
    if (!open) return;
    fetchPage(1);
  }, [open, fetchPage]);

  // Escape + click-outside close. Only bound while open.
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  // Clear a pending close timer on unmount.
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  function openNow() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }

  // Small delay so the pointer can travel from the trigger into the panel.
  function closeSoon() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }

  // No likes yet: plain badge, nothing to reveal.
  if ((Number(count) || 0) === 0) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-600",
          className,
        )}>
        <Heart aria-hidden="true" className="h-3 w-3" />0
      </span>
    );
  }

  return (
    <span
      ref={wrapRef}
      className={cn("relative inline-flex", className)}
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
      onFocus={openNow}
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget)) setOpen(false);
      }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Liked by ${count} ${count === 1 ? "person" : "people"} — show who liked this announcement`}
        className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-600 transition hover:bg-rose-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
        <Heart aria-hidden="true" className="h-3 w-3 fill-current" />
        {count}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="People who liked this announcement"
          className="absolute bottom-full left-0 z-30 mb-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-slate-200 bg-white text-left shadow-xl">
          <div className="border-b border-slate-100 px-3 py-2">
            <p className="text-xs font-semibold text-slate-700">
              Liked by {total}
            </p>
          </div>

          {loading ? (
            <Spinner className="py-4" label="Loading…" />
          ) : error ? (
            <div className="px-3 py-4 text-center">
              <p className="text-xs text-red-600" role="alert">
                {error.message}
              </p>
              <button
                type="button"
                onClick={() => fetchPage(page)}
                className="mt-2 text-xs font-medium text-brand-600 hover:text-brand-800">
                Retry
              </button>
            </div>
          ) : rows.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-slate-400">
              No likes yet.
            </p>
          ) : (
            <ul className="max-h-60 divide-y divide-slate-50 overflow-y-auto">
              {rows.map((like) => {
                const name =
                  like.user?.full_name || like.user?.email || "Unknown user";
                return (
                  <li key={like.id} className="flex items-center gap-2 px-3 py-2">
                    <Avatar name={name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-slate-700">
                        {name}
                      </p>
                      <p className="truncate text-[11px] text-slate-400">
                        {formatDateTime(like.created_at)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-2 py-1.5 text-[11px] text-slate-500">
              <button
                type="button"
                onClick={() => fetchPage(page - 1)}
                disabled={page <= 1 || loading}
                aria-label="Previous page of likes"
                className="rounded p-1 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => fetchPage(page + 1)}
                disabled={page >= totalPages || loading}
                aria-label="Next page of likes"
                className="rounded p-1 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </span>
  );
}
