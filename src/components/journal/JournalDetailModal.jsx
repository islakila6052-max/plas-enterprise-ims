// src/components/journal/JournalDetailModal.jsx
import Modal from "@/components/ui/Modal";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { MessageSquareQuote, CalendarDays, Clock } from "lucide-react";
import { JOURNAL_STATUS_LABELS } from "@/lib/constants";
import { formatDate, formatHours } from "@/utils/format";

const TONE = { pending: "amber", approved: "green", rejected: "red" };

/** A labelled block of free text, omitted entirely when the intern left it blank. */
function Section({ title, value }) {
  if (!value) return null;
  return (
    <section>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </h4>
      <p className="whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
        {value}
      </p>
    </section>
  );
}

/**
 * Full, untruncated view of a journal entry.
 *
 * Cards show a clamped preview so the history list stays scannable; this opens
 * the complete text. Read-only: an intern must not be able to edit a submitted
 * entry or a supervisor's feedback from here.
 */
export default function JournalDetailModal({ journal, open, onClose }) {
  if (!journal) return null;

  const comment = journal.supervisor_comment?.trim();
  const hasComment = Boolean(comment);

  return (
    <Modal open={open} onClose={onClose} title="Journal Entry" size="lg">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4 text-slate-400" aria-hidden />
              {formatDate(journal.date)}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-slate-400" aria-hidden />
              {journal.hours_worked != null
                ? formatHours(Number(journal.hours_worked))
                : "No hours logged"}
            </span>
          </div>
          <Badge tone={TONE[journal.status] ?? "gray"}>
            {JOURNAL_STATUS_LABELS[journal.status] ?? journal.status}
          </Badge>
        </div>

        <Section title="Activities" value={journal.activities} />
        <Section title="Challenges" value={journal.challenges} />
        <Section title="Learnings" value={journal.learnings} />

        {/* Surface the comment here too, so the full read is self-contained. */}
        <section>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Supervisor Feedback
          </h4>
          {hasComment ? (
            <div className="flex gap-2 rounded-lg border border-brand-100 bg-brand-50/60 p-3">
              <MessageSquareQuote
                aria-hidden
                className="mt-0.5 h-4 w-4 shrink-0 text-brand-600"
              />
              <p className="whitespace-pre-wrap break-words text-sm text-slate-700">
                {comment}
              </p>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-sm text-slate-400">
              No feedback yet — your supervisor hasn&apos;t reviewed this entry.
            </p>
          )}
        </section>

        {/* No "View Feedback" action here: the supervisor's comment is already
            rendered in full directly above, so a button to open a second modal
            containing the same text would be redundant. */}
        <div className="flex justify-end border-t border-slate-100 pt-3">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
