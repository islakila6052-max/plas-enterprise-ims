// src/pages/intern/InternAnnouncements.jsx
import { useEffect, useState, useCallback } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";
import ErrorAlert from "@/components/ui/ErrorAlert";
import LikeButton from "@/components/announcements/LikeButton";
import { announcementService } from "@/services/announcementService";
import { useAuth } from "@/contexts/AuthContext";

import { ANNOUNCEMENT_CATEGORIES } from "@/lib/constants";
import { formatDateTime, timeAgo } from "@/utils/format";

const catLabel = Object.fromEntries(ANNOUNCEMENT_CATEGORIES.map((c) => [c.value, c.label]));

/**
 * Like row shared by the pinned and recent cards so both stay in sync, with a
 * single place defining the "likes unavailable" fallback copy.
 */
function LikeRow({ announcement, onToggle, likesAvailable }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
      <LikeButton
        count={announcement.like_count}
        liked={announcement.liked_by_me}
        onToggle={() => onToggle(announcement)}
        disabled={!likesAvailable}
      />
      {!likesAvailable && (
        <span className="text-xs text-slate-400">Liking is temporarily unavailable.</span>
      )}
    </div>
  );
}

export default function InternAnnouncements() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [likesAvailable, setLikesAvailable] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await announcementService.list({ userId: user?.id ?? null });
      setRows(res.data ?? []);
      setLikesAvailable(res.likesAvailable !== false);
    } catch (err) {
      setLoadError(err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Persists the like and mirrors the server's answer into local state so the
   * count survives re-renders, pagination and navigation. Errors are re-thrown
   * so LikeButton can roll its optimistic update back.
   */
  const handleToggle = useCallback(
    async (announcement) => {
      const result = await announcementService.toggleLike(announcement.id, user?.id);
      setRows((prev) =>
        prev.map((row) =>
          row.id === announcement.id
            ? {
                ...row,
                liked_by_me: result.liked,
                like_count: result.count ?? row.like_count,
              }
            : row,
        ),
      );
      return result;
    },
    [user?.id],
  );

  const pinned = rows.filter((a) => a.pinned);
  const recent = rows.filter((a) => !a.pinned);

  return (
    <div>
      <PageHeader title="Announcements" description="Company news and important reminders." />
      {loading ? (
        <Spinner label="Loading announcements…" />
      ) : loadError ? (
        <ErrorAlert message={loadError.message} onRetry={load} loading={loading} />
      ) : (
        <div className="space-y-6">
          {pinned.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Pinned</h3>
              <div className="space-y-4">
                {pinned.map((a) => (
                  <Card key={a.id} className="border-brand-200 bg-brand-50/40">
                    <div className="p-5">
                      <div className="mb-1 flex items-center gap-2">
                        <Badge tone="green">Pinned</Badge>
                        <Badge tone="brand">{catLabel[a.category] ?? a.category}</Badge>
                        <span className="text-xs text-slate-400">
                          {timeAgo(a.created_at)} · {formatDateTime(a.created_at)}
                        </span>
                      </div>
                      <h3 className="break-words text-base font-semibold text-slate-800">
                        {a.title}
                      </h3>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">
                        {a.body}
                      </p>
                      <LikeRow announcement={a} onToggle={handleToggle} likesAvailable={likesAvailable} />
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Recent</h3>
            <div className="space-y-4">
              {recent.map((a) => (
                <Card key={a.id}>
                  <div className="p-5">
                    <div className="mb-1 flex items-center gap-2">
                      <Badge tone="brand">{catLabel[a.category] ?? a.category}</Badge>
                      <span className="text-xs text-slate-400">
                        {timeAgo(a.created_at)} · {formatDateTime(a.created_at)}
                      </span>
                    </div>
                    <h3 className="break-words text-base font-semibold text-slate-800">
                      {a.title}
                    </h3>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">
                      {a.body}
                    </p>
                    <LikeRow announcement={a} onToggle={handleToggle} likesAvailable={likesAvailable} />
                  </div>
                </Card>
              ))}
              {recent.length === 0 && pinned.length === 0 && (
                <Card>
                  <p className="p-5 text-center text-sm text-slate-500">
                    No announcements yet. New company news will appear here.
                  </p>
                </Card>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
