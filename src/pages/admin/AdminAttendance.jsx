// src/pages/admin/AdminAttendance.jsx
import { useEffect, useState, useCallback } from "react";
import { toast } from "react-hot-toast";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Table from "@/components/ui/Table";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";
import Pagination from "@/components/ui/Pagination";
import Button from "@/components/ui/Button";
import ErrorAlert from "@/components/ui/ErrorAlert";
import { Input, Select } from "@/components/ui/Input";
import { attendanceService } from "@/services/attendanceService";

import {
  ATTENDANCE_STATUS,
  ATTENDANCE_STATUS_LABELS,
  PAGE_SIZE,
} from "@/lib/constants";
import { formatDate, formatTime, formatHours } from "@/utils/format";

const TONE = {
  present: "green",
  late: "amber",
  absent: "red",
  pending: "gray",
};

export default function AdminAttendance() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState("");
  const [claimFilter, setClaimFilter] = useState("");
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (dateFrom && dateTo && dateFrom > dateTo) {
        throw new Error("The From date cannot be after the To date.");
      }
      const res = await attendanceService.adminList({ dateFrom, dateTo, page });
      let data = res.data;
      if (status) data = data.filter((r) => r.status === status);
      if (claimFilter) {
        if (claimFilter === "pending") {
          data = data.filter((r) => r.claim_status === "pending");
        } else if (claimFilter === "reviewed") {
          data = data.filter(
            (r) =>
              r.claim_status === "approved" || r.claim_status === "rejected",
          );
        }
      }
      setRows(data);
      setTotal(res.count);
    } catch (err) {
      setError(err);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, status, claimFilter, page]);

  useEffect(() => {
    load();
  }, [load]);

  if (error && rows.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Attendance"
          description="View and manage attendance records."
        />
        <ErrorAlert message={error.message} onRetry={load} loading={loading} />
      </div>
    );
  }

  function exportCSV() {
    if (exporting) return;
    if (!rows.length) return toast.error("No rows to export.");
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return toast.error("No internet connection. Please reconnect before exporting.");
    }
    setExporting(true);
    try {
      const header = [
        "Intern",
        "Date",
        "Time In",
        "Time Out",
        "Hours",
        "Status",
      ];
      const esc = (v) => {
        const s = String(v ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = rows.map((r) => [
        esc(r.intern?.full_name ?? ""),
        esc(r.date),
        esc(r.time_in ?? ""),
        esc(r.time_out ?? ""),
        esc(r.total_hours),
        esc(r.status),
      ]);
      const csv = [header, ...lines].map((row) => row.join(",")).join("\n");
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const from = dateFrom || "start";
      const to = dateTo || "end";
      a.download = `attendance-${from}-${to}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Attendance exported (CSV).");
    } finally {
      setExporting(false);
    }
  }

  const columns = [
    {
      key: "intern",
      header: "Intern",
      render: (r) => (
        <div>
          <p className="font-medium text-slate-800">{r.intern?.full_name}</p>
          <p className="text-xs text-slate-400">{r.intern?.last_name}</p>
        </div>
      ),
    },
    { key: "date", header: "Date", render: (r) => formatDate(r.date) },
    { key: "time_in", header: "Time In", render: (r) => formatTime(r.time_in) },
    {
      key: "time_out",
      header: "Time Out",
      render: (r) => formatTime(r.time_out),
    },
    {
      key: "total_hours",
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
        if (r.claim_status === "pending")
          return <Badge tone="amber">Pending</Badge>;
        if (r.claim_status === "approved")
          return <Badge tone="green">Approved</Badge>;
        if (r.claim_status === "rejected")
          return <Badge tone="red">Rejected</Badge>;
        return "—";
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Attendance"
        description="Organization-wide attendance records."
        action={
          <Button variant="secondary" onClick={exportCSV} loading={exporting}>
            Export CSV
          </Button>
        }
      />
      <Card>
        <div className="grid gap-3 border-b border-brand-100 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            type="date"
            maxLength={10}
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            className="max-w-xs"
            label="From"
          />
          <Input
            type="date"
            maxLength={10}
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            className="max-w-xs"
            label="To"
          />
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="max-w-xs"
            label="Status">
            <option value="">All Statuses</option>
            {Object.values(ATTENDANCE_STATUS).map((s) => (
              <option key={s} value={s}>
                {ATTENDANCE_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select
            value={claimFilter}
            onChange={(e) => {
              setClaimFilter(e.target.value);
              setPage(1);
            }}
            className="max-w-xs"
            label="Claim">
            <option value="">All Claims</option>
            <option value="pending">Pending Claims</option>
            <option value="reviewed">Reviewed Claims</option>
          </Select>
        </div>
        {loading ? (
          <Spinner label="Loading attendance…" />
        ) : (
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            empty={
              <div className="p-4 text-center text-sm text-slate-500">
                No attendance records.
              </div>
            }
          />
        )}
        {rows.length > 0 && (
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={setPage}
          />
        )}
      </Card>
    </div>
  );
}
