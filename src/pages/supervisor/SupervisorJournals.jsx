// src/pages/supervisor/SupervisorJournals.jsx
import { useEffect, useState, useCallback } from "react";
import { toast } from "react-hot-toast";
import { ClipboardCheck } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Table from "@/components/ui/Table";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";
import ErrorAlert from "@/components/ui/ErrorAlert";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { Textarea, Input } from "@/components/ui/Input";
import { journalService } from "@/services/journalService";
import { useAuth } from "@/contexts/AuthContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { JOURNAL_STATUS, JOURNAL_STATUS_LABELS } from "@/lib/constants";
import { formatDate } from "@/utils/format";
import { recordAudit, notify } from "@/services/activityService";
import ActionButton from "@/components/ui/ActionButton";

const TONE = { pending: "amber", approved: "green", rejected: "red" };

export default function SupervisorJournals() {
  const { profile, supervisorId, user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [reviewing, setReviewing] = useState(null);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const debouncedSearch = useDebouncedValue(search, 400);

  const load = useCallback(async () => {
    if (!supervisorId) {
      setRows([]);
      setLoading(false);
      setLoadError(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const sid = supervisorId;
      const res = await journalService.list({
        supervisorId: sid,
        page: 1,
        pageSize: 100,
      });
      let data = res.data ?? [];
      if (status) data = data.filter((r) => r.status === status);
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        data = data.filter((r) =>
          (r.intern?.full_name ?? "").toLowerCase().includes(q),
        );
      }
      setRows(data);
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, [supervisorId, status, debouncedSearch]);

  useEffect(() => {
    load();
  }, [load]);

  function openReview(r) {
    setReviewing(r);
    setComment(r.supervisor_comment ?? "");
  }

  async function decide(decision) {
    if (!reviewing) return;
    if (saving) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("No internet connection. Please check your network and try again.");
      return;
    }
    setSaving(true);
    try {
      const sid = supervisorId;
      await journalService.review(reviewing.id, decision, sid, comment);
      await recordAudit({
        user_id: user?.id,
        action: "review",
        resource_type: "daily_journal",
        resource_id: reviewing.id,
        changes: { status: decision, supervisor_comment: comment },
      });
      if (reviewing.intern?.profile_id)
        await notify({
          user_id: reviewing.intern.profile_id,
          type: "journal_review",
          title: `Journal ${decision}`,
          message: `Your journal for ${reviewing.date} was ${decision}.`,
          link: "/intern/journal",
        });
      toast.success(`Journal ${decision}.`);
      setReviewing(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    {
      key: "intern",
      header: "Intern",
      render: (r) => r.intern?.full_name ?? "—",
    },
    { key: "date", header: "Date", render: (r) => formatDate(r.date) },
    {
      key: "activities",
      header: "Activities",
      render: (r) => (
        <p className="max-w-xs truncate text-slate-600">{r.activities}</p>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge tone={TONE[r.status] ?? "gray"}>
          {JOURNAL_STATUS_LABELS[r.status] ?? r.status}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <ActionButton
          icon={ClipboardCheck}
          color="blue"
          tooltip="Review"
          onClick={() => openReview(r)}
        />
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Daily Journals"
        description="Review and comment on your interns' journals."
      />
      <Card>
        <div className="grid gap-3 border-b border-brand-100 p-4 sm:grid-cols-2">
          <Input
            placeholder="Search intern name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="max-w-xs rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm text-slate-700">
            <option value="">All Statuses</option>
            {Object.values(JOURNAL_STATUS).map((s) => (
              <option key={s} value={s}>
                {JOURNAL_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        {loading ? (
          <Spinner label="Loading journals…" />
        ) : loadError ? (
          <div className="p-5">
            <ErrorAlert message={loadError.message} onRetry={load} loading={loading} />
          </div>
        ) : (
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            empty={
              <div className="p-4 text-center text-sm text-slate-500">
                {debouncedSearch || status
                  ? "No journals match these filters."
                  : "No journals to review."}
              </div>
            }
          />
        )}
      </Card>

      <Modal
        open={Boolean(reviewing)}
        onClose={() => !saving && setReviewing(null)}
        title="Review Journal"
        footer={
          <>
            <Button
              variant="danger"
              onClick={() => decide("rejected")}
              loading={saving}>
              Reject
            </Button>
            <Button onClick={() => decide("approved")} loading={saving}>
              Approve
            </Button>
          </>
        }>
        {reviewing && (
          <div className="space-y-3 text-sm">
            <p>
              <span className="text-slate-500">Intern: </span>
              {reviewing.intern?.full_name}
            </p>
            <p>
              <span className="text-slate-500">Date: </span>
              {formatDate(reviewing.date)}
            </p>
            <div>
              <p className="mb-1 font-medium text-slate-700">Activities</p>
              <p className="whitespace-pre-wrap break-words text-slate-600">
                {reviewing.activities}
              </p>
            </div>
            <div>
              <p className="mb-1 font-medium text-slate-700">Challenges</p>
              <p className="whitespace-pre-wrap break-words text-slate-600">
                {reviewing.challenges || "—"}
              </p>
            </div>
            <div>
              <p className="mb-1 font-medium text-slate-700">Learnings</p>
              <p className="whitespace-pre-wrap break-words text-slate-600">
                {reviewing.learnings || "—"}
              </p>
            </div>
            <Textarea
              label="Comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
