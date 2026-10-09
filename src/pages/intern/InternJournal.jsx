// src/pages/intern/InternJournal.jsx
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { toast } from "react-hot-toast";
import { useForm } from "react-hook-form";
import {
  Plus,
  NotebookPen,
  Clock,
  Flame,
  CheckCircle2,
  MessageSquareQuote,
  Hourglass,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { Input, Textarea, CharCounter } from "@/components/ui/Input";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";
import ErrorAlert from "@/components/ui/ErrorAlert";
import { journalService } from "@/services/journalService";
import { useAuth } from "@/contexts/AuthContext";
import { JOURNAL_STATUS_LABELS } from "@/lib/constants";
import { formatDate, formatHours, todayISO } from "@/utils/format";
import { recordAudit, notify } from "@/services/activityService";
import { supabase } from "@/lib/supabase";
import JournalDetailModal from "@/components/journal/JournalDetailModal";
import MonthProgress from "@/components/journal/MonthProgress";
import SubmitCelebration from "@/components/journal/SubmitCelebration";
import JournalPagination from "@/components/journal/JournalPagination";

const TONE = { pending: "amber", approved: "green", rejected: "red" };

/** Journal entries shown per page in the history list. */
const PAGE_SIZE = 5;

/** Icons per status, so state reads correctly without relying on colour alone. */
const STATUS_ICON = { approved: CheckCircle2, pending: Clock, rejected: null };

/**
 * Consecutive-day streak ending today, or yesterday so an intern who has not
 * written yet today does not watch it reset to zero mid-morning.
 * Counts distinct calendar days, so two entries on one date count once.
 */
function computeStreak(dates, today = todayISO()) {
  const days = new Set(dates.filter(Boolean).map((d) => String(d).slice(0, 10)));
  if (days.size === 0) return 0;

  // UTC-based date math. Building a local-midnight Date and reading
  // toISOString() silently loses a day in any timezone east of UTC (in UTC+8,
  // '2026-09-29' came back as '2026-09-27'), which would corrupt every streak.
  const shift = (iso, delta) => {
    const [y, m, d] = String(iso).split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    t.setUTCDate(t.getUTCDate() + delta);
    return t.toISOString().slice(0, 10);
  };

  // Anchor on the most recent day that keeps the streak alive.
  let cursor = days.has(today) ? today : shift(today, -1);
  if (!days.has(cursor)) return 0;

  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = shift(cursor, -1);
  }
  return streak;
}

/** One compact stat in the summary strip. */
function StatChip({ icon: Icon, value, label, tone = "brand" }) {
  const toneClass = {
    brand: "text-brand-600 bg-brand-50",
    amber: "text-amber-600 bg-amber-50",
    slate: "text-slate-500 bg-slate-100",
  }[tone];

  return (
    <div className="flex items-center gap-2.5 px-1 py-1">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${toneClass}`}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold leading-tight text-slate-800 tabular-nums">{value}</p>
        <p className="truncate text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
}

/** One journal entry rendered as a card rather than a table row. */
function JournalCard({ journal, onReadFull }) {
  const hasComment = Boolean(journal.supervisor_comment?.trim());
  const StatusIcon = STATUS_ICON[journal.status];

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-brand-200">
      {/* Header: date + status */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-800">{formatDate(journal.date)}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
            <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {journal.hours_worked != null
              ? formatHours(Number(journal.hours_worked))
              : "No hours logged"}
          </p>
        </div>
        <Badge tone={TONE[journal.status] ?? "gray"}>
          {StatusIcon && <StatusIcon className="mr-1 h-3 w-3" aria-hidden />}
          {JOURNAL_STATUS_LABELS[journal.status] ?? journal.status}
        </Badge>
      </div>

      {/* Clamped preview keeps the list scannable; the full text is one click away. */}
      <section className="mt-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Today&apos;s Activities
        </h4>
        <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm text-slate-700">
          {journal.activities || "—"}
        </p>
      </section>

      {/* Optional fields shown only when written, and only as short hints. */}
      {(journal.challenges || journal.learnings) && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          {journal.challenges && (
            <span className="min-w-0">
              <span className="font-medium text-slate-600">Challenges: </span>
              <span className="line-clamp-1">{journal.challenges}</span>
            </span>
          )}
          {journal.learnings && (
            <span className="min-w-0">
              <span className="font-medium text-slate-600">Learnings: </span>
              <span className="line-clamp-1">{journal.learnings}</span>
            </span>
          )}
        </div>
      )}

      {/* Actions row. The feedback status is shown as text only — the comment
          itself is read from the "Read Full Journal" modal, which displays it
          inline. A second "View Feedback" button here would open the same
          content twice on one card. */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <p
          className={`flex min-w-0 items-center gap-1.5 text-xs ${
            hasComment ? "font-medium text-brand-700" : "text-slate-400"
          }`}>
          <MessageSquareQuote aria-hidden className="h-3.5 w-3.5 shrink-0" />
          {hasComment ? "Supervisor left feedback" : "No feedback yet"}
        </p>
        <button
          type="button"
          onClick={() => onReadFull(journal)}
          className="flex min-h-[36px] items-center rounded-lg px-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
          Read Full Journal
        </button>
      </div>
    </article>
  );
}

export default function InternJournal() {
  const { profile, internId } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  // The form is collapsed by default so the page reads as a journal to review
  // rather than a blank form to fill in.
  const [formOpen, setFormOpen] = useState(false);
  // Which journal entry is open in the full "Read Full Journal" modal, which
  // also shows the supervisor's feedback inline.
  const [detailJournal, setDetailJournal] = useState(null);
  // Current page of the journal history list (5 entries per page).
  const [page, setPage] = useState(1);
  // Scrolled into view on page change, so the intern lands on the new entries
  // instead of wherever the previous page happened to leave them.
  const historyRef = useRef(null);
  // Drives the short celebration overlay after a successful submission.
  const [celebrating, setCelebrating] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm({
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: { date: todayISO(), activities: "", hours_worked: "", challenges: "", learnings: "" },
  });

  const load = useCallback(async () => {
    if (!internId) {
      setRows([]);
      setLoading(false);
      setLoadError(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const res = await journalService.list({ internId, page: 1, pageSize: 30 });
      // NOTE: `rows` holds the COMPLETE, unfiltered set on purpose. The stat
      // strip, the day streak, the month calendar and "today's entries" are all
      // derived from it, so they must describe the intern's real history rather
      // than whatever happens to match the current search box. The search is
      // applied later, at render time, to the paginated list only.
      //
      // Filtering here instead meant typing in the search box rewrote
      // "Journal Entries", "Hours Logged", "Day Streak" and "Pending Reviews",
      // and emptied the calendar - so a search appeared to delete data.
      setRows(res.data ?? []);
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, [internId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onSubmit(values) {
    if (saving) return;
    if (!internId) {
      toast.error("Your intern profile isn't linked yet. Please contact an administrator.");
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("No internet connection. Please check your network and try again.");
      return;
    }
    if (values.date && values.date > todayISO()) {
      toast.error("Journal date cannot be in the future.");
      return;
    }
    setSaving(true);
    try {
      const created = await journalService.create({
        intern_id: internId,
        date: values.date,
        activities: values.activities,
        hours_worked: Number(values.hours_worked) || 0,
        challenges: values.challenges,
        learnings: values.learnings,
        status: "pending",
      });
      await recordAudit({ user_id: profile?.id, action: "create", resource_type: "daily_journal", resource_id: created?.id, changes: { date: values.date } });

      // Notify the assigned supervisor about the new journal entry.
      try {
        const { data: intern } = await supabase
          .from("interns")
          .select("full_name, supervisor_id")
          .eq("id", internId)
          .single();
        if (intern?.supervisor_id) {
          // `intern.supervisor_id` is a supervisors.id, so resolve it through
          // the SECURITY DEFINER helper (profiles is no longer listable).
          const { data: supProfileId } = await supabase.rpc(
            "supervisor_profile_id",
            { p_supervisor_row_id: intern.supervisor_id },
          );
          if (supProfileId) {
            await notify({
              user_id: supProfileId,
              type: "journal_submitted",
              title: "New journal entry",
              message: `${profile?.full_name || "An intern"} submitted a journal entry for ${values.date}.`,
              link: "/supervisor/journals",
              metadata: { intern_id: internId, journal_id: created?.id },
            });
          }
        }
      } catch {
        /* non-fatal */
      }

      toast.success("Journal submitted.");
      reset({ date: todayISO(), activities: "", hours_worked: "", challenges: "", learnings: "" });
      // Collapse the form so the new entry is immediately visible in the list.
      setFormOpen(false);
      // Hold the refresh until the celebration has played, so the intern sees
      // the acknowledgement first and the refreshed list (with their new entry
      // and updated streak) lands underneath it. Submission and validation are
      // unchanged — only the follow-up refresh is deferred.
      setCelebrating(true);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Summary figures for the motivational strip. `rows` is already limited to
  // the most recent 30 entries, so these describe what the intern sees rather
  // than their lifetime totals.
  const stats = useMemo(() => {
    const totalHours = rows.reduce(
      (sum, r) => sum + (Number(r.hours_worked) || 0),
      0,
    );
    return {
      entries: rows.length,
      hours: Math.round(totalHours * 100) / 100,
      streak: computeStreak(rows.map((r) => r.date)),
      // Awaiting a supervisor decision, so the intern knows it is not stuck.
      pending: rows.filter((r) => r.status === "pending").length,
    };
  }, [rows]);

  const today = todayISO();
  const todayEntries = useMemo(
    () => rows.filter((r) => String(r.date ?? "").slice(0, 10) === today),
    [rows, today],
  );
  const hasEntryToday = todayEntries.length > 0;

  // The search is applied HERE, at render time, instead of inside `load()`.
  // `rows` stays the intern's complete history, so the stat strip, the day
  // streak, the month calendar and "today's entries" below are unaffected by
  // what is typed into the search box. Only the list on the right reacts to it.
  const searchTerm = search.trim().toLowerCase();
  const filteredRows = useMemo(() => {
    if (!searchTerm) return rows;
    return rows.filter((r) =>
      (r.activities ?? "").toLowerCase().includes(searchTerm),
    );
  }, [rows, searchTerm]);

  // Paginate the filtered list only. The unfiltered `rows` above still backs
  // the stats, the streak and the calendar, so neither searching nor paging can
  // change any of those figures.
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const visibleRows = useMemo(
    () => filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredRows, safePage],
  );

  // A new search can leave the current page beyond the last page, so reset.
  useEffect(() => {
    setPage(1);
  }, [search]);

  function handlePageChange(next) {
    setPage(next);
    // Keep keyboard focus predictable: move it to the new page's first entry
    // rather than leaving it on a control that may no longer exist.
    if (historyRef.current) {
      historyRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function openForm() {
    reset({
      date: today,
      activities: "",
      hours_worked: "",
      challenges: "",
      learnings: "",
    });
    setFormOpen(true);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Daily Journal"
        description="Document your OJT journey, one day at a time."
      />

      {/* Summary strip: gives a reason to return to the page. */}
      <Card>
        <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
          <StatChip
            icon={NotebookPen}
            value={stats.entries}
            label={stats.entries === 1 ? "Journal Entry" : "Journal Entries"}
          />
          <StatChip
            icon={Clock}
            value={formatHours(stats.hours)}
            label="Hours Logged"
            tone="slate"
          />
          <StatChip
            icon={Flame}
            value={stats.streak}
            label="Day Streak"
            tone="amber"
          />
          <StatChip
            icon={Hourglass}
            value={stats.pending}
            label="Pending Reviews"
            tone="slate"
          />
        </div>
        {stats.streak > 0 && (
          <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">
            Keep documenting your OJT journey — you&apos;re on a{" "}
            <span className="font-semibold text-amber-600">
              {stats.streak}-day streak
            </span>
            .
          </p>
        )}
      </Card>

      {/* Today's Journal: a compact status line plus the single primary action,
          so the intern always knows whether today is done. */}
      <Card>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-800">
                Today&apos;s Journal
              </h3>
              {hasEntryToday && (
                <Badge tone="green">
                  <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />
                  Submitted
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {hasEntryToday
                ? todayEntries.length === 1
                  ? "You've documented today. Add another entry if you worked later."
                  : `You've submitted ${todayEntries.length} entries today.`
                : "You haven't documented today yet."}
            </p>
          </div>

          {!formOpen && (
            <Button onClick={openForm} className="w-full sm:w-auto">
              <Plus className="h-4 w-4" aria-hidden />
              Write Today&apos;s Journal
            </Button>
          )}
        </div>

        {/* Entries already written today, summarised without opening anything. */}
        {hasEntryToday && (
          <div className="border-t border-slate-100 px-4 py-3">
            <ul className="space-y-1.5">
              {todayEntries.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate text-slate-600">
                    {e.activities || "No activities recorded"}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-slate-400 tabular-nums">
                      {formatHours(Number(e.hours_worked) || 0)}
                    </span>
                    <Badge tone={TONE[e.status] ?? "gray"}>
                      {JOURNAL_STATUS_LABELS[e.status] ?? e.status}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* The form is an action, not a permanent blank panel. */}
      {formOpen ? (
        <Card>
          <div className="flex items-center justify-between border-b border-brand-100 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-800">
              {hasEntryToday ? "Add Another Entry" : "Write Today's Journal"}
            </h3>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="min-h-[36px] rounded-lg px-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700">
              Close
            </button>
          </div>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Date"
                maxLength={10}
                type="date"
                max={today}
                error={errors.date?.message}
                {...register("date", {
                  required: "Date is required",
                  validate: (v) =>
                    !v || v <= today || "Date cannot be in the future",
                })}
              />
              <Input
                label="Hours Worked"
                maxLength={6}
                type="number"
                step="0.5"
                min={0}
                max={24}
                error={errors.hours_worked?.message}
                {...register("hours_worked", {
                  required: "Hours worked is required",
                  min: { value: 0, message: "Hours worked must be 0 or greater" },
                  max: { value: 24, message: "Hours worked cannot exceed 24" },
                })}
              />
            </div>

            <div>
              <Textarea
                label="What did you work on today?"
                placeholder="e.g. Updated the inventory database and helped test the new POS screen with the cashier…"
                rows={4}
                maxLength={250}
                error={errors.activities?.message}
                {...register("activities", {
                  required: "Activities are required",
                  validate: (v) =>
                    (v ?? "").trim().length > 0 || "Activities are required",
                })}
              />
              <CharCounter value={watch("activities")} limit={250} />
            </div>

            <div>
              <Textarea
                label="What challenges did you encounter?"
                placeholder="e.g. The report was slow because the export timed out — I asked my supervisor how to narrow the date range…"
                rows={3}
                maxLength={250}
                {...register("challenges")}
              />
              <CharCounter value={watch("challenges")} limit={250} />
            </div>

            <div>
              <Textarea
                label="What did you learn today?"
                placeholder="e.g. How to write a clean SQL JOIN, and why the team always runs migrations before deploying…"
                rows={3}
                maxLength={250}
                {...register("learnings")}
              />
              <CharCounter value={watch("learnings")} limit={250} />
            </div>

            <div className="flex flex-wrap gap-3">
              <Button type="submit" loading={saving}>
                Submit Journal
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {/* Two-column layout on desktop: entries take the wide left column and the
          calendar sits in a narrow right rail, where it stays anchored to the
          right-hand side. On mobile the two stack, and the calendar is ordered
          first so the monthly overview is visible before the entries. The two
          orderings are driven purely by `order-first` / `lg:order-last` on the
          calendar, which leaves the desktop arrangement untouched. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        {/* Recent journals — 3 of 4 columns on desktop */}
        <Card className="lg:col-span-3" ref={historyRef}>
          <div className="flex flex-col gap-3 border-b border-brand-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-base font-semibold text-slate-800">Recent Journals</h3>
            <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
              <Input
                placeholder="Search activities…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="sm:max-w-xs"
                aria-label="Search journal activities"
              />
              {/* Makes it explicit that the search narrows this list only, and
                  not the totals above or the calendar beside it. */}
              {searchTerm && !loading && !loadError && (
                <p className="text-xs text-slate-500 sm:pr-1">
                  {filteredRows.length === 0
                    ? "No matches"
                    : `Showing ${filteredRows.length} of ${rows.length}`}
                </p>
              )}
            </div>
          </div>
          <div className="p-4">
            {loading ? (
              <Spinner label="Loading journals…" />
            ) : loadError ? (
              <ErrorAlert
                message={loadError.message}
                onRetry={load}
                loading={loading}
              />
            ) : rows.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-slate-500">
                  No journals submitted yet. Start documenting your OJT journey
                  today.
                </p>
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-slate-500">
                  No journals match &ldquo;{search.trim()}&rdquo;.
                </p>
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="mt-2 text-sm font-semibold text-brand-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                >
                  Clear search
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {visibleRows.map((r) => (
                  <JournalCard
                    key={r.id}
                    journal={r}
                    onReadFull={setDetailJournal}
                  />
                ))}
              </div>
            )}
          </div>
          <JournalPagination
            page={safePage}
            totalItems={filteredRows.length}
            pageSize={PAGE_SIZE}
            onPageChange={handlePageChange}
          />
        </Card>

        {/* Monthly calendar — 1 of 4 columns on the right on desktop, and the
            first stacked block on mobile via `order-first`. */}
        <div className="order-first lg:col-span-1 lg:order-last">
          <MonthProgress rows={rows} onSelectDay={setDetailJournal} />
        </div>
      </div>

      {/* Short acknowledgement after a successful submission. `pointer-events-none`
          so it never blocks the page while it is on screen. */}
      <SubmitCelebration
        show={celebrating}
        onDone={() => setCelebrating(false)}
        message="Great job documenting your OJT journey today."
      />

      {/* Feedback is rendered inline inside the detail modal, so no separate
          feedback modal is needed here. */}
      <JournalDetailModal
        journal={detailJournal}
        open={Boolean(detailJournal)}
        onClose={() => setDetailJournal(null)}
      />
    </div>
  );
}
