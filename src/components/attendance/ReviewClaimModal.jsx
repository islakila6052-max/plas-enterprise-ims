// src/components/attendance/ReviewClaimModal.jsx
import { useState, useEffect } from "react";
import { formatDate, formatTime } from "@/utils/format";
import Button from "@/components/ui/Button";

export default function ReviewClaimModal({
  open,
  onClose,
  onReview,
  attendanceRecord,
  loading = false,
}) {
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (open) setComment("");
  }, [open]);

  if (!open || !attendanceRecord) return null;

  const handleApprove = () => {
    onReview("approved", comment.trim() || null);
  };

  const handleReject = () => {
    onReview("rejected", comment.trim() || null);
  };

  return (
    <div className="fixed inset-0 z-50 min-h-screen min-h-[100dvh] overflow-y-auto flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <h3 className="text-lg font-semibold text-slate-800">
            Review Missed Clock-out Claim
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {attendanceRecord.intern?.full_name ?? "Intern"} claims they forgot
            to clock out on {formatDate(attendanceRecord.date)}.
          </p>
        </div>

        <div className="space-y-4 px-6 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-brand-50/50 px-3 py-2">
              <p className="text-xs text-slate-400">Time In</p>
              <p className="font-medium text-slate-700">
                {formatTime(attendanceRecord.time_in)}
              </p>
            </div>
            <div className="rounded-lg bg-brand-50/50 px-3 py-2">
              <p className="text-xs text-slate-400">Claimed Time Out</p>
              <p className="font-medium text-slate-700">
                {formatTime(attendanceRecord.claimed_time_out)}
              </p>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-slate-600">
              Intern's Reason
            </p>
            <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-slate-700">
              {attendanceRecord.claim_remarks || "No reason provided."}
            </p>
          </div>

          <div>
            <label
              htmlFor="reviewComment"
              className="text-sm font-medium text-slate-600">
              Review Comment{" "}
              <span className="text-xs text-slate-400">(optional)</span>
            </label>
            <textarea
              id="reviewComment"
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="Add a comment about this claim" maxLength={500}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
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
          <Button
            type="button"
            variant="danger"
            onClick={handleReject}
            loading={loading}>
            Reject
          </Button>
          <Button type="button" onClick={handleApprove} loading={loading}>
            Approve
          </Button>
        </div>
      </div>
    </div>
  );
}
