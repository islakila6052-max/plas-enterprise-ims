// src/pages/supervisor/SupervisorAttendance.jsx
import { useEffect, useState, useCallback } from "react";
import { toast } from "react-hot-toast";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Table from "@/components/ui/Table";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";
import ErrorAlert from "@/components/ui/ErrorAlert";
import Button from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import ReviewClaimModal from "@/components/attendance/ReviewClaimModal";
import { attendanceService } from "@/services/attendanceService";
import { useAuth } from "@/contexts/AuthContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { ATTENDANCE_STATUS, ATTENDANCE_STATUS_LABELS } from "@/lib/constants";
import { formatDate, formatTime, formatHours } from "@/utils/format";
import { recordAudit, notify } from "@/services/activityService";
import { supabase } from "@/lib/supabase";

const TONE = {
  present: "green",
  late: "amber",
  absent: "red",
  pending: "gray",
};

export default function SupervisorAttendance() {
  const { profile, supervisorId } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [claimFilter, setClaimFilter] = useState("");
  const [reviewRecord, setReviewRecord] = useState(null);
  const [reviewing, setReviewing] = useState(false);
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
      const res = await attendanceService.adminList({
        supervisorId,
        page: 1,
        pageSize: 100,
      });
      let filtered = res.data ?? [];
      if (status) filtered = filtered.filter((r) => r.status === status);
      if (claimFilter) {
        if (claimFilter === "pending") {
          filtered = filtered.filter((r) => r.claim_status === "pending");
        } else if (claimFilter === "reviewed") {
          filtered = filtered.filter(
            (r) =>
              r.claim_status === "approved" || r.claim_status === "rejected",
          );
        }
      }
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        filtered = filtered.filter((r) =>
          (r.intern?.full_name ?? "").toLowerCase().includes(q),
        );
      }
      setRows(filtered);
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, [supervisorId, status, claimFilter, debouncedSearch]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleReview(decision, comment) {
    if (!reviewRecord) return;
    if (reviewing) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("No internet connection. Please check your network and try again.");
      return;
    }
    setReviewing(true);
    try {
      await attendanceService.reviewClaim(
        reviewRecord.id,
        decision,
        profile?.id,
        comment,
      );

      await recordAudit({
        user_id: profile?.id,
        action: "review",
        resource_type: "attendance_claim",
        resource_id: reviewRecord.id,
        changes: {
          decision,
          claimed_time_out: reviewRecord.claimed_time_out,
          comment,
        },
      });

      // Notify the intern about the claim review
      try {
        const { data: intern } = await supabase
          .from("interns")
          .select("profile_id, full_name")
          .eq("id", reviewRecord.intern_id)
          .single();

        if (intern?.profile_id) {
          await notify({
            user_id: intern.profile_id,
            type: "attendance_update",
            title: `Clock-out claim ${decision}`,
            message:
              decision === "approved"
                ? `Your claimed clock-out for ${formatDate(reviewRecord.date)} was approved.`
                : `Your claimed clock-out for ${formatDate(reviewRecord.date)} was rejected.`,
            link: "/intern/attendance",
            metadata: { attendance_id: reviewRecord.id, decision },
          });
        }
      } catch {
        /* non-fatal */
      }

      toast.success(
        decision === "approved"
          ? "Claim approved. Time out recorded."
          : "Claim rejected.",
      );
      setReviewRecord(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setReviewing(false);
    }
  }

  const columns = [
    {
      key: "intern",
      header: "Intern",
      render: (r) => r.intern?.full_name ?? "—",
    },
    { key: "date", header: "Date", render: (r) => formatDate(r.date) },
    { key: "time_in", header: "Time In", render: (r) => formatTime(r.time_in) },
    {
      key: "time_out",
      header: "Time Out",
      render: (r) =>
        r.time_out ? (
          formatTime(r.time_out)
        ) : (
          <span className="text-amber-600">—</span>
        ),
    },
    {
      key: "hours",
      header: "Hours",
      render: (r) => formatHours(r.total_hours),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge tone={TONE[r.status] ?? "gray"}>
          {ATTENDANCE_STATUS_LABELS[r.status] ?? r.status}
        </Badge>
      ),
    },
    {
      key: "claim",
      header: "Claim",
      render: (r) => {
        if (r.claim_status === "pending") {
          return (
            <div className="flex items-center gap-2">
              <Badge tone="amber">Pending</Badge>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setReviewRecord(r)}>
                Review
              </Button>
            </div>
          );
        }
        if (r.claim_status === "approved") {
          return <Badge tone="green">Approved</Badge>;
        }
        if (r.claim_status === "rejected") {
          return <Badge tone="red">Rejected</Badge>;
        }
        return "—";
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Attendance"
        description="Attendance of your assigned interns."
      />
      <Card>
        <div className="grid gap-3 border-b border-brand-100 p-4 sm:grid-cols-3">
          <Input
            placeholder="Search intern name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="max-w-xs">
            <option value="">All Statuses</option>
            {Object.values(ATTENDANCE_STATUS).map((s) => (
              <option key={s} value={s}>
                {ATTENDANCE_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select
            value={claimFilter}
            onChange={(e) => setClaimFilter(e.target.value)}
            className="max-w-xs">
            <option value="">All Claims</option>
            <option value="pending">Pending Claims</option>
            <option value="reviewed">Reviewed Claims</option>
          </Select>
        </div>
        {loading ? (
          <Spinner label="Loading attendance…" />
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
                {debouncedSearch || status || claimFilter
                  ? "No attendance records match these filters."
                  : "No attendance records."}
              </div>
            }
          />
        )}
      </Card>

      <ReviewClaimModal
        open={Boolean(reviewRecord)}
        onClose={() => !reviewing && setReviewRecord(null)}
        onReview={handleReview}
        attendanceRecord={reviewRecord}
        loading={reviewing}
      />
    </div>
  );
}
