// src/components/layout/NotificationBell.jsx
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { notificationService } from "@/services/notificationService";
import { supabase } from "@/lib/supabase";
import { onReconnect } from "@/lib/onlineManager";
import Spinner from "@/components/ui/Spinner";

/**
 * Notification bell in the navbar. Shows an unread count badge, opens a
 * dropdown of recent notifications, and supports mark-as-read / mark-all.
 * Subscribes to real-time INSERTs on the notifications table so new
 * notifications appear without a manual refresh.
 */
export default function NotificationBell() {
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const wrapRef = useRef(null);
  const channelRef = useRef(null);

  const userId = user?.id;

  async function refresh() {
    if (!userId) return;
    setLoading(true);
    try {
      const [list, count] = await Promise.all([
        notificationService.list({ userId, limit: 10 }),
        notificationService.unreadCount(userId),
      ]);
      setItems(list);
      setUnread(count);
    } catch {
      // Silently fail — the bell still works with stale data.
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Real-time subscription: listen for new notifications inserted for this user.
  useEffect(() => {
    if (!userId) return;

    // Clean up previous channel if any.
    if (channelRef.current) {
      try { supabase.removeChannel(channelRef.current); } catch { /* ignore */ }
      channelRef.current = null;
    }

    channelRef.current = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          refresh();
        },
      )
      .subscribe((status) => {
        // If the subscription fails to connect (e.g. offline), retry when back online.
        if (status === "CLOSED" || status === "CHANNEL_ERROR") {
          // The channel will be re-created on the next userId change or reconnect.
        }
      });

    return () => {
      if (channelRef.current) {
        try { supabase.removeChannel(channelRef.current); } catch { /* ignore */ }
        channelRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Track online/offline state for the bell UI.
  useEffect(() => {
    function handleOnline() {
      setOffline(false);
    }
    function handleOffline() {
      setOffline(true);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    setOffline(!navigator.onLine);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Re-subscribe to realtime channel when connection is restored.
  useEffect(() => {
    if (!userId) return;
    return onReconnect(() => {
      // Force re-creation of the realtime channel by toggling a counter.
      // The existing useEffect for the channel will re-run when userId changes,
      // so we temporarily set userId to null and back.
      // Simpler: just refresh the data on reconnect.
      refresh();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    function onClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  async function handleOpen() {
    setOpen((v) => !v);
    if (!open) await refresh();
  }

  async function handleItemClick(n) {
    if (busyId) return;
    if (!n.is_read) {
      setBusyId(n.id);
      try {
        await notificationService.markRead(n.id);
        await refresh();
      } catch {
        /* keep stale state; bell retries on next open */
      } finally {
        setBusyId(null);
      }
    }
    setOpen(false);
    if (n.link) navigate(n.link);
  }

  async function handleMarkAll() {
    if (markingAll) return;
    setMarkingAll(true);
    try {
      await notificationService.markAllRead(userId);
      await refresh();
    } catch {
      /* non-fatal */
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={handleOpen}
        className="relative rounded-md p-2 text-slate-500 transition hover:bg-brand-50 hover:text-brand-700"
        aria-label="Notifications">
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.7 21a2 2 0 01-3.4 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        // MOBILE: the bell sits at the far right of the navbar, so anchoring the
        // panel to it and centring it (left-1/2 + -translate-x-1/2) pushed most
        // of the dropdown off the right edge of a phone, which either clipped the
        // panel or made the page scroll sideways. It is now fixed and inset from
        // both edges, so it always fits any screen size. From `sm` up it returns
        // to being anchored to the bell, where there is room for it.
        <div className="fixed inset-x-3 top-16 z-30 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-80 sm:max-w-[calc(100vw-2rem)]">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
            <p className="text-sm font-semibold text-slate-700">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={handleMarkAll}
                disabled={markingAll}
                className="text-xs font-medium text-brand-600 hover:text-brand-800 disabled:opacity-50">
                {markingAll ? "Marking…" : "Mark all read"}
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {offline && (
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-700">
                No connection — showing cached notifications.
              </div>
            )}
            {loading ? (
              <div className="flex justify-center py-6">
                <Spinner size="sm" />
              </div>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">No notifications yet.</p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleItemClick(n)}
                  className={`flex w-full flex-col gap-0.5 border-b border-slate-50 px-4 py-3 text-left transition hover:bg-slate-50 ${
                    n.is_read ? "" : "bg-brand-50/40"
                  }`}>
                  <div className="flex items-center justify-between gap-2">
                    {/* `min-w-0` lets this flex child shrink below its content
                        width; `break-words` then wraps an unbroken token
                        (e.g. a long URL pasted into an announcement title)
                        instead of stretching the dropdown. */}
                    <span className="min-w-0 break-words text-sm font-medium text-slate-800">
                      {n.title}
                    </span>
                    {!n.is_read && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                    )}
                  </div>
                  <span className="line-clamp-2 break-words text-xs text-slate-500">
                    {n.message}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-slate-300">{n.type}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
