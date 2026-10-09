// src/components/announcements/LikeButton.jsx
import { useCallback, useState } from "react";
import { toast } from "react-hot-toast";
import { Heart } from "lucide-react";
import { cn } from "@/utils/cn";

/**
 * Accessible like/unlike toggle for announcements.
 *
 * Reliability rules baked in:
 *  - rapid repeated clicks are ignored while a request is in flight;
 *  - offline clicks fail fast with a clear message instead of hanging;
 *  - the UI updates optimistically and rolls back when the server call fails,
 *    so the displayed count never drifts from the database;
 *  - `onToggle` is the single source of truth for the final value — if the
 *    server disagrees with the optimistic guess, its answer wins.
 *
 * @param {number}   count       Current number of likes.
 * @param {boolean}  liked       Whether the signed-in user has liked it.
 * @param {Function} onToggle    async () => ({ liked, count }) — performs the
 *                               write. Errors are surfaced via toast.
 * @param {boolean}  [disabled]  Disable when likes aren't supported/known.
 * @param {string}   [className]
 */
export default function LikeButton({
  count = 0,
  liked = false,
  onToggle,
  disabled = false,
  className = "",
}) {
  const [busy, setBusy] = useState(false);
  const [optimistic, setOptimistic] = useState(null);

  const displayLiked = optimistic ? optimistic.liked : liked;
  const displayCount = optimistic ? optimistic.count : count;
  const blocked = disabled || busy || typeof onToggle !== "function";

  const handleClick = useCallback(async () => {
    // Guard against double-clicks / impatient repeat taps and against
    // handlers that were not provided.
    if (busy || disabled || typeof onToggle !== "function") return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("No internet connection. Please check your network and try again.");
      return;
    }

    const previous = { liked, count };
    const guess = {
      liked: !liked,
      count: Math.max(0, count + (liked ? -1 : 1)),
    };
    setOptimistic(guess);
    setBusy(true);
    try {
      const result = await onToggle();
      // Prefer the server's value when it is provided; otherwise keep the
      // optimistic guess (already shown).
      if (result && typeof result.liked === "boolean") {
        setOptimistic({ liked: result.liked, count: result.count ?? guess.count });
      }
    } catch (err) {
      // Roll back so the heart and the number stay truthful.
      setOptimistic(previous);
      toast.error(err?.message || "Could not update your like. Please try again.");
    } finally {
      setBusy(false);
      // Drop the override so the component follows the parent's fresh data
      // (loaded via refresh) instead of holding a stale local value.
      setOptimistic(null);
    }
  }, [busy, disabled, onToggle, liked, count]);

  const label = displayLiked
    ? `Unlike this announcement (${displayCount} ${displayCount === 1 ? "like" : "likes"})`
    : `Like this announcement (${displayCount} ${displayCount === 1 ? "like" : "likes"})`;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={blocked}
      aria-pressed={displayLiked}
      aria-label={label}
      title={displayLiked ? "Unlike" : "Like"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
        displayLiked
          ? "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100"
          : "border-slate-200 bg-white text-slate-500 hover:border-rose-200 hover:text-rose-600",
        blocked && "cursor-not-allowed opacity-60",
        className,
      )}>
      <Heart
        aria-hidden="true"
        className={cn("h-3.5 w-3.5", displayLiked && "fill-current", busy && "animate-pulse")}
      />
      <span aria-live="polite" className="tabular-nums">
        {displayCount}
      </span>
    </button>
  );
}
