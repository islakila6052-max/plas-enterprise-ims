// src/pages/admin/AdminAuditLogs.jsx
import { useEffect, useState, useCallback } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";
import Table from "@/components/ui/Table";
import { auditLogService } from "@/services/auditLogService";
import { formatDateTime, timeAgo } from "@/utils/format";

const ACTION_TONES = {
  create: "green",
  update: "blue",
  delete: "red",
  login: "gray",
  review: "amber",
};

/** Human-readable labels for the fields that commonly appear in audit logs. */
const FIELD_LABELS = {
  full_name: "Full Name",
  first_name: "First Name",
  last_name: "Last Name",
  email: "Email",
  contact_number: "Contact Number",
  bio: "Bio",
  role: "Role",
  status: "Status",
  department_id: "Department",
  supervisor_id: "Supervisor",
  program_id: "Program",
  institution_id: "Institution",
  required_hours: "Required Hours",
  start_date: "Start Date",
  end_date: "End Date",
  student_number: "Student No.",
  title: "Title",
  body: "Message",
  category: "Category",
  pinned: "Pinned",
  activities: "Activities",
  hours_worked: "Hours Worked",
  date: "Date",
  time_in: "Time In",
  time_out: "Time Out",
  total_hours: "Total Hours",
  claimed_time_out: "Claimed Time Out",
};

/** "full_name" -> "Full name" for any field without an explicit label. */
function fieldLabel(field) {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  return String(field)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Format a single change value for display. */
function formatValue(v) {
  if (v === null || v === undefined || v === "") return "—";
  // Map raw enum values (roles, statuses) to readable labels.
  return VALUE_LABELS[String(v)] ?? String(v);
}

/** Friendly labels for enum-ish values that appear in change diffs. */
const VALUE_LABELS = {
  admin: "Admin",
  hr_staff: "HR Staff",
  supervisor: "Supervisor",
  intern: "Intern",
  active: "Active",
  completed: "Completed",
  archived: "Archived",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  present: "Present",
  late: "Late",
  absent: "Absent",
};

/** Friendly labels for the resource types that appear in the audit trail. */
const RESOURCE_LABELS = {
  profile: "Profile",
  intern: "Intern",
  attendance: "Attendance",
  attendance_claim: "Attendance Claim",
  daily_journal: "Daily Journal",
  document: "Document",
  evaluation: "Evaluation",
  announcement: "Announcement",
  supervisor: "Supervisor",
  department: "Department",
  auth_user: "Auth User",
};

/**
 * Render a changes entry. Entries are stored as { from, to } pairs so both
 * the previous value and the updated value are always shown. Flat legacy
 * values ({ field: "x" }) are treated as the updated value only.
 */
function ChangeEntry({ field, value }) {
  const isPair =
    value !== null &&
    typeof value === "object" &&
    !(value instanceof Date) &&
    ("from" in value || "to" in value);

  const from = isPair ? value.from : null;
  const to = isPair ? value.to : value;

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="font-medium text-slate-600">{fieldLabel(field)}:</span>
      <span className="inline-flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {/* Previous Value — omitted for CREATE (nothing existed before). */}
        {from !== null && (
          <span className="inline-flex items-baseline gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Previous Value:
            </span>
            <span className="rounded bg-red-50 px-1.5 py-0.5 font-mono text-xs text-red-600 line-through decoration-red-300">
              {formatValue(from)}
            </span>
          </span>
        )}
        {from === null && isPair && (
          <span className="inline-flex items-baseline gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Previous Value:
            </span>
            <span className="font-mono text-xs italic text-slate-400">
              none (new record)
            </span>
          </span>
        )}
        {/* Updated Value — for DELETE this shows what was removed. */}
        {to !== null && (
          <span className="inline-flex items-baseline gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Updated Value:
            </span>
            <span className="rounded bg-green-50 px-1.5 py-0.5 font-mono text-xs text-green-700">
              {formatValue(to)}
            </span>
          </span>
        )}
        {to === null && (
          <span className="inline-flex items-baseline gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Updated Value:
            </span>
            <span className="font-mono text-xs italic text-slate-400">
              removed
            </span>
          </span>
        )}
      </span>
    </div>
  );
}

/** Admin read-only view of the audit trail. */
export default function AdminAuditLogs() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await auditLogService.list({ limit: 200 });
      setRows(data);
    } catch (err) {
      // Non-fatal: audit logs are an admin-only convenience view.
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const columns = [
    {
      key: "created_at",
      header: "When",
      render: (r) => (
        <div className="whitespace-nowrap">
          <div className="text-slate-700">{timeAgo(r.created_at)}</div>
          <div className="text-xs text-slate-400">
            {formatDateTime(r.created_at)}
          </div>
        </div>
      ),
    },
    {
      key: "action",
      header: "Action",
      render: (r) => (
        <Badge tone={ACTION_TONES[r.action] ?? "gray"}>{r.action}</Badge>
      ),
    },
    {
      key: "resource_type",
      header: "Resource",
      render: (r) => (
        <span className="font-mono text-xs text-slate-600">
          {RESOURCE_LABELS[r.resource_type] ?? r.resource_type}
        </span>
      ),
    },
    {
      key: "resource_id",
      header: "Resource ID",
      render: (r) => (
        <span className="font-mono text-xs text-slate-500">
          {r.resource_id ?? "—"}
        </span>
      ),
    },
    {
      key: "user_id",
      header: "User",
      render: (r) => {
        // Prefer the acting user's name (embedded profile); fall back to
        // their email, then "Unknown user" for deleted accounts, then
        // "system" for entries with no user at all.
        if (r.user?.full_name) {
          return (
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-700">
                {r.user.full_name}
              </p>
              <p className="truncate text-[11px] text-slate-400">
                {r.user.email}
              </p>
            </div>
          );
        }
        if (r.user?.email) {
          return (
            <span className="text-slate-600">{r.user.email}</span>
          );
        }
        return (
          <span className="font-mono text-xs text-slate-500">
            {r.user_id ? "Unknown user" : "system"}
          </span>
        );
      },
    },
    {
      key: "changes",
      header: "Changes",
      render: (r) => {
        if (!r.changes || typeof r.changes !== "object")
          return <span className="text-xs text-slate-500">—</span>;
        const entries = Object.entries(r.changes);
        if (entries.length === 0)
          return <span className="text-xs text-slate-500">—</span>;
        return (
          <div className="max-w-md space-y-2 rounded-lg border border-slate-100 bg-slate-50/60 p-2">
            {entries.map(([field, value]) => (
              <ChangeEntry key={field} field={field} value={value} />
            ))}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Audit Logs"
        description="A read-only trail of administrative and system actions."
      />
      <Card>
        {loading ? (
          <Spinner label="Loading audit logs…" />
        ) : (
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            empty={
              <div className="py-10 text-center text-sm text-slate-500">
                No audit logs yet.
              </div>
            }
          />
        )}
      </Card>
    </div>
  );
}
