// src/components/attendance/ClaimTimeOutForm.jsx
import { useState, useEffect } from "react";
import Modal from "@/components/ui/Modal";
import {
  formatDate,
  formatTime,
  manilaWallTimeToISO,
  todayDateInAttendanceTZ,
} from "@/utils/format";
import Button from "@/components/ui/Button";

export default function ClaimTimeOutForm({
  open,
  onClose,
  onConfirm,
  attendanceRecord,
  loading = false,
}) {
  const [remarks, setRemarks] = useState("");
  const [claimedTimeOut, setClaimedTimeOut] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!open) return;

    setRemarks("");
    setFormError("");
    // Default to current time in HH:mm format
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    setClaimedTimeOut(`${hours}:${minutes}`);
  }, [open]);

  const handleSubmit = (e) => {
    e.preventDefault();
    setFormError("");

    if (!remarks.trim()) {
      setFormError("Please provide a reason for the missed clock-out.");
      return;
    }

    const dateStr = attendanceRecord?.date || todayDateInAttendanceTZ();
    const claimedDateTime = manilaWallTimeToISO(dateStr, claimedTimeOut);

    if (!claimedDateTime) {
      setFormError("Please enter a valid time.");
      return;
    }

    if (attendanceRecord?.time_in && new Date(claimedDateTime) <= new Date(attendanceRecord.time_in)) {
      setFormError("Claimed time out must be after time in.");
      return;
    }

    onConfirm({
      claimedTimeOut: claimedDateTime,
      remarks: remarks.trim(),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Claim Missed Clock-out"
      description="⚠️ You forgot to clock out for this attendance record. Submit a claimed time-out for supervisor approval."
      size="sm"
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={loading}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} loading={loading}>
            Submit Claim
          </Button>
        </>
      }>
      <form onSubmit={handleSubmit}>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-600">
              Attendance Date
            </label>
            <p className="text-sm text-slate-800">
              {attendanceRecord?.date
                ? formatDate(attendanceRecord.date)
                : new Date().toLocaleDateString()}
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-600">
              Time In
            </label>
            <p className="text-sm text-slate-800">
              {attendanceRecord?.time_in
                ? formatTime(attendanceRecord.time_in)
                : "—"}
            </p>
          </div>

          <div>
            <label
              htmlFor="claimedTimeOut"
              className="text-sm font-medium text-slate-600">
              Claimed Time Out *
            </label>
            <input
              id="claimedTimeOut"
              type="time"
              maxLength={5}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              value={claimedTimeOut}
              onChange={(e) => setClaimedTimeOut(e.target.value)}
              required
            />
            <p className="mt-0.5 text-xs text-slate-500">
              Enter the time you claim to have clocked out.
            </p>
          </div>

          <div>
            <label
              htmlFor="claimRemarks"
              className="text-sm font-medium text-slate-600">
              Reason * <span className="text-xs text-slate-400">(required)</span>
            </label>
            <textarea
              id="claimRemarks"
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="Why did you forget to clock out? e.g., I had to leave urgently" maxLength={500}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              required
            />
            <p className="mt-1 text-xs text-amber-600">
              * Required: Please explain why you missed the clock-out.
            </p>
            {formError && (
              <p className="mt-1 text-xs font-medium text-red-600" role="alert">
                {formError}
              </p>
            )}
          </div>
        </div>
      </form>
    </Modal>
  );
}
