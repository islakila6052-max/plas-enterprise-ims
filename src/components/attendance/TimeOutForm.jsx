// src/components/attendance/TimeOutForm.jsx
import { useState, useEffect } from "react";
import {
  formatDate,
  formatTime,
  manilaWallTimeToISO,
  todayDateInAttendanceTZ,
} from "@/utils/format";
import Button from "@/components/ui/Button";

export default function TimeOutForm({
  open,
  onClose,
  onConfirm,
  attendanceRecord,
  isForgotten = false,
  loading = false,
}) {
  const [remarks, setRemarks] = useState("");
  const [timeOut, setTimeOut] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (open) {
      setRemarks("");
      setFormError("");
      // Set default time out to current time in HH:mm format
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      setTimeOut(`${hours}:${minutes}`);
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    setFormError("");
    // Require remarks for forgotten timeouts
    if (isForgotten && !remarks.trim()) {
      setFormError("Please provide a reason for forgetting to time out.");
      return;
    }

    // Create full datetime from the date and time input
    const dateStr = attendanceRecord?.date || todayDateInAttendanceTZ();
    // Interpret the chosen wall-clock time as Asia/Manila (the attendance
    // timezone) and store the resulting instant.
    const timeOutDateTime = manilaWallTimeToISO(dateStr, timeOut);

    if (!timeOutDateTime) {
      setFormError("Please enter a valid time.");
      return;
    }

    if (attendanceRecord?.time_in && new Date(timeOutDateTime) <= new Date(attendanceRecord.time_in)) {
      setFormError("Time out must be after time in.");
      return;
    }

    onConfirm({
      timeOut: timeOutDateTime,
      remarks: remarks.trim() || null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 min-h-dvh overflow-y-auto flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <form onSubmit={handleSubmit}>
          <div className="border-b border-slate-200 px-6 py-4">
            <h3 className="text-lg font-semibold text-slate-800">
              {isForgotten ? "Forgotten Time Out" : "Time Out"}
            </h3>
            {isForgotten && (
              <p className="mt-1 text-sm text-amber-600">
                ⚠️ You forgot to time out for this attendance record.
              </p>
            )}
          </div>

          <div className="space-y-4 px-6 py-4">
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
                htmlFor="timeOut"
                className="text-sm font-medium text-slate-600">
                Time Out
              </label>
              <input
                id="timeOut"
                type="time"
                maxLength={5}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                value={timeOut}
                onChange={(e) => setTimeOut(e.target.value)}
                required
              />
              <p className="mt-0.5 text-xs text-slate-500">
                Enter the time you want to record as time out.
              </p>
              {formError && (
                <p className="mt-1 text-xs font-medium text-red-600" role="alert">
                  {formError}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="remarks"
                className="text-sm font-medium text-slate-600">
                {isForgotten ? "Reason *" : "Remarks"}
                <span className="text-xs text-slate-400">
                  {isForgotten ? " (required)" : " (optional)"}
                </span>
              </label>
              <textarea
                id="remarks"
                rows={3}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                placeholder={
                  isForgotten
                    ? "Please explain why you forgot to time out..."
                    : "Any remarks about today's attendance..."
                }
                maxLength={500}
              value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                required={isForgotten}
              />
              {isForgotten && (
                <p className="mt-1 text-xs text-amber-600">
                  * Required: Please provide a reason for the forgotten time
                  out.
                </p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              {isForgotten ? "Submit Time Out" : "Confirm Time Out"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
