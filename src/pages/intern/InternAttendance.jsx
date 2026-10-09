// src/pages/intern/InternAttendance.jsx
import { useEffect, useState, useCallback } from "react";
import { toast } from "react-hot-toast";
import { Printer } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Table from "@/components/ui/Table";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ErrorAlert from "@/components/ui/ErrorAlert";
import TimeOutForm from "@/components/attendance/TimeOutForm";
import ClaimTimeOutForm from "@/components/attendance/ClaimTimeOutForm";
import DtrModal from "@/components/attendance/DtrModal";
import { attendanceService } from "@/services/attendanceService";
import { useAuth } from "@/contexts/AuthContext";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/constants";
import {
  formatDate,
  formatTime,
  formatHours,
  todayDateInAttendanceTZ,
  nowMinuteInAttendanceTZ,
} from "@/utils/format";
import { recordAudit, notify } from "@/services/activityService";
import { supabase } from "@/lib/supabase";

const TONE = {
  present: "green",
  late: "amber",
  absent: "red",
  pending: "gray",
};

export default function InternAttendance() {
  const { profile, internId } = useAuth();
  const [open, setOpen] = useState(null);
  const [todayRec, setTodayRec] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showTimeOutForm, setShowTimeOutForm] = useState(false);
  const [timeOutRecord, setTimeOutRecord] = useState(null);
  const [isForgottenTimeout, setIsForgottenTimeout] = useState(false);
  const [showClaimForm, setShowClaimForm] = useState(false);
  const [claimRecord, setClaimRecord] = useState(null);
  const [remarksModal, setRemarksModal] = useState({ open: false, text: "" });
  // Daily Time Record modal. Opens the read-only DTR generator.
  const [showDtr, setShowDtr] = useState(false);

  const load = useCallback(async () => {
    if (!internId) {
      setRows([]);
      setTodayRec(null);
      setOpen(null);
      setLoading(false);
      setLoadError(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [todayRecord, res] = await Promise.all([
        attendanceService.getToday(internId),
        attendanceService.list({ internId, page: 1, pageSize: 30 }),
      ]);
      setTodayRec(todayRecord);
      setOpen(todayRecord && !todayRecord.time_out ? todayRecord : null);
      setRows(res.data ?? []);
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, [internId]);

  useEffect(() => {
    let active = true;
    (async () => {
      await load();
      if (!active) return;
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [internId]);

  const [confirmOpen, setConfirmOpen] = useState(false);

  async function confirmTimeIn() {
    if (busy) return;
    if (!internId) {
      toast.error("Your intern profile isn't linked yet. Please contact an administrator.");
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("No internet connection. Please check your network and try again.");
      return;
    }
    setConfirmOpen(false);
    setBusy(true);
    try {
      const rec = await attendanceService.timeIn(internId, "manual");
      await recordAudit({
        user_id: profile?.id,
        action: "create",
        resource_type: "attendance",
        resource_id: rec?.id,
        changes: { type: "time_in", date: todayDateInAttendanceTZ() },
      });

      // Notify supervisor
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
              type: "attendance_update",
              title: "Time in recorded",
              message: `${intern.full_name || "Your intern"} just timed in for ${todayDateInAttendanceTZ()}.`,
              link: "/supervisor/attendance",
              metadata: { intern_id: internId },
            });
          }
        }
      } catch {
        /* non-fatal */
      }

      toast.success("Timed in.");
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  // src/pages/intern/InternAttendance.jsx
  // Update the handleTimeOut function:

  async function handleTimeOut({ timeOut, remarks }) {
    if (busy) return;
    if (!open?.id) {
      toast.error("No open attendance record found.");
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("No internet connection. Please check your network and try again.");
      return;
    }
    setBusy(true);
    try {
      await attendanceService.timeOut(open.id, timeOut, remarks);
      await recordAudit({
        user_id: profile?.id,
        action: "update",
        resource_type: "attendance",
        resource_id: open.id,
        changes: { type: "time_out", timeOut, remarks },
      });

      // Notify supervisor
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
              type: "attendance_update",
              title: "Time out recorded",
              message: `${intern.full_name || "Your intern"} timed out for ${formatDate(open.date)}.`,
              link: "/supervisor/attendance",
              metadata: { intern_id: internId },
            });
          }
        }
      } catch {
        /* non-fatal */
      }

      toast.success("Timed out.");
      setShowTimeOutForm(false);
      setTimeOutRecord(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const handleOpenTimeOutForm = () => {
    // Check if this is a forgotten timeout (record from a previous day)
    const today = todayDateInAttendanceTZ();
    const isForgotten = open?.date !== today;

    setIsForgottenTimeout(isForgotten);
    setTimeOutRecord(open);
    setShowTimeOutForm(true);
  };

  async function handleClaimSubmit({ claimedTimeOut, remarks }) {
    if (busy) return;
    if (!claimRecord?.id) {
      toast.error("No attendance record selected for this claim.");
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("No internet connection. Please check your network and try again.");
      return;
    }
    setBusy(true);
    try {
      await attendanceService.submitClaim(
        claimRecord.id,
        claimedTimeOut,
        remarks,
      );
      toast.success("Claim submitted. Awaiting supervisor approval.");
      setShowClaimForm(false);
      setClaimRecord(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const columns = [
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
      key: "claim_status",
      header: "Claim",
      render: (r) => {
        // Claim status takes priority so approved/rejected indicators remain
        // visible even after time_out is set on approval.
        if (r.claim_status === "pending")
          return <Badge tone="amber">Claim Pending</Badge>;
        if (r.claim_status === "approved")
          return <Badge tone="green">Claim Approved</Badge>;
        if (r.claim_status === "rejected")
          return <Badge tone="red">Claim Rejected</Badge>;

        // No time_out and no claim yet.
        if (!r.time_out) {
          // If this is the currently-open record (the one the user can time
          // out via the Time Out button), never show a claim action — the
          // intern still has the normal Time Out option available.
          if (open?.id === r.id) return "—";

          // Normalize the row date to YYYY-MM-DD to be safe against any
          // formatting differences returned by the API.
          const rowDate = String(r.date || "").slice(0, 10);
          const today = todayDateInAttendanceTZ();
          const isToday = rowDate === today;

          // For today's record, only allow a claim after 5 PM — before that
          // the intern can still clock out normally via the Time Out button.
          if (isToday) {
            // Claim allowed for today only after 5:00 PM in the attendance
            // timezone (Asia/Manila). Before that the intern clocks out
            // normally via the Time Out button.
            if (nowMinuteInAttendanceTZ() < 17 * 60) return "—";
          }

          // Previous-day records (or after 5 PM today) offer the claim action.
          return (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setClaimRecord(r);
                setShowClaimForm(true);
              }}>
              Claim Time Out
            </Button>
          );
        }
        return "—";
      },
    },
    {
      key: "remarks",
      header: "Remarks",
      render: (r) => {
        const text = r.remarks?.trim();
        if (!text) return "—";

        const preview = text.length > 18 ? `${text.slice(0, 18)}...` : text;

        return (
          <button
            type="button"
            className="max-w-[220px] truncate text-left text-sm text-slate-700 underline decoration-slate-300 underline-offset-2 transition hover:text-slate-900"
            onClick={() => setRemarksModal({ open: true, text })}
            title={text}>
            {preview}
          </button>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Attendance"
        description="Time in and out and view your attendance history."
        action={
          <Button
            variant="secondary"
            onClick={() => setShowDtr(true)}
            disabled={!internId}
          >
            <Printer className="mr-2 h-4 w-4" aria-hidden />
            Generate / Print DTR
          </Button>
        }
      />

      {/* Daily Time Record. Read-only: it renders the intern's existing
          attendance rows and never creates or edits one. */}
      <DtrModal open={showDtr} onClose={() => setShowDtr(false)} />

      <Card>
        <div className="flex flex-col items-start justify-between gap-4 p-5 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm text-slate-500">
              Today · {todayDateInAttendanceTZ()}
            </p>
            {open ? (
              <p className="mt-1 text-sm font-medium text-emerald-600">
                You are timed in since {formatTime(open.time_in)}
                {open.date !== todayDateInAttendanceTZ() && (
                  <span className="ml-2 text-xs text-amber-600">
                    (Previous day)
                  </span>
                )}
              </p>
            ) : todayRec?.time_out ? (
              <p className="mt-1 text-sm font-medium text-slate-600">
                You have completed your attendance for today.
              </p>
            ) : (
              <p className="mt-1 text-sm font-medium text-slate-600">
                You haven't timed in today.
              </p>
            )}
          </div>
          {open ? (
            <Button onClick={handleOpenTimeOutForm} loading={busy}>
              Time Out
            </Button>
          ) : todayRec?.time_out ? (
            <Button disabled variant="secondary">
              Attendance Completed
            </Button>
          ) : (
            <Button onClick={() => setConfirmOpen(true)} loading={busy}>
              Time In
            </Button>
          )}
        </div>
      </Card>

      {/* Time In Confirmation */}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmTimeIn}
        title="Time in for today?"
        message={`You can only record one attendance per day. Confirm to time in for ${todayDateInAttendanceTZ()}.`}
        confirmLabel="Yes, Time In"
        tone="primary"
        loading={busy}
      />

      {/* Time Out Form */}
      <TimeOutForm
        open={showTimeOutForm}
        onClose={() => {
          setShowTimeOutForm(false);
          setTimeOutRecord(null);
        }}
        onConfirm={handleTimeOut}
        attendanceRecord={timeOutRecord}
        isForgotten={isForgottenTimeout}
        loading={busy}
      />

      {/* Claim Missed Clock-out Form */}
      <ClaimTimeOutForm
        open={showClaimForm}
        onClose={() => {
          setShowClaimForm(false);
          setClaimRecord(null);
        }}
        onConfirm={handleClaimSubmit}
        attendanceRecord={claimRecord}
        loading={busy}
      />

      {remarksModal.open && (
        <div className="fixed inset-0 z-50 min-h-screen min-h-[100dvh] overflow-y-auto flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-800">Remarks</h3>
            </div>
            <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              {remarksModal.text}
            </div>
            <div className="mt-4 flex justify-end">
              <Button
                onClick={() => setRemarksModal({ open: false, text: "" })}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      <Card>
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-800">History</h3>
        </div>
        {loading ? (
          <Spinner label="Loading history…" />
        ) : loadError ? (
          <div className="p-5">
            <ErrorAlert
              message={loadError.message}
              onRetry={load}
              loading={loading}
            />
          </div>
        ) : (
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            empty={
              <div className="p-4 text-center text-sm text-slate-500">
                No attendance records yet.
              </div>
            }
          />
        )}
      </Card>
    </div>
  );
}
