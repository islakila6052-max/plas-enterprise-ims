// src/components/institutions/InstitutionTable.jsx
import { Pencil, Eye, Trash2 } from "lucide-react";
import Table from "@/components/ui/Table";
import ActionButton from "@/components/ui/ActionButton";
import Avatar from "@/components/ui/Avatar";
import EmptyState from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/icons";
import { formatDate } from "@/utils/format";

/**
 * Institution table.
 * @param rows        institutions (each may carry computed `program_count` / `active_intern_count`)
 * @param sort        { key, dir }
 * @param onSort      (key) => void
 * @param onEdit / onDelete / onView
 */
export default function InstitutionTable({
  rows,
  sort,
  onSort,
  onEdit,
  onDelete,
  onView,
  loading,
}) {
  const Sortable = ({ label, k, className = "" }) => (
    <button
      type="button"
      onClick={() => onSort?.(k)}
      className={cn(
        "inline-flex items-center gap-1 font-semibold uppercase tracking-wide transition hover:text-brand-700",
        sort?.key === k && "text-brand-700",
        className,
      )}>
      {label}
      <Icon
        name={
          sort?.key === k
            ? sort.dir === "asc"
              ? "chevronUp"
              : "chevronDown"
            : "chevronDown"
        }
        className="h-3.5 w-3.5 opacity-50"
      />
    </button>
  );

  const columns = [
    {
      key: "institution_name",
      header: <Sortable label="Institution" k="institution_name" />,
      render: (r) => (
        <div className="flex items-center gap-3">
          <Avatar src={r.logo_url} name={r.institution_name} size="md" />
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-800">
              {r.institution_name}
            </p>
            <p className="truncate text-xs text-slate-500">
              {[r.abbreviation, r.campus].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "address",
      header: "Address",
      render: (r) => <span className="text-slate-600">{r.address || "—"}</span>,
    },
    {
      key: "program_count",
      header: <Sortable label="Programs" k="program_count" />,
      render: (r) => (
        <span className="font-medium text-slate-700">
          {r.program_count ?? 0}
        </span>
      ),
    },
    {
      key: "active_intern_count",
      header: <Sortable label="Active Interns" k="active_intern_count" />,
      render: (r) => (
        <span className="font-medium text-slate-700">
          {r.active_intern_count ?? 0}
        </span>
      ),
    },
    {
      key: "updated_at",
      header: <Sortable label="Last Updated" k="updated_at" />,
      render: (r) => (
        <span className="text-xs text-slate-500">
          {formatDate(r.updated_at)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (r) => (
        <div className="flex items-center justify-center gap-1">
          <ActionButton
            icon={Eye}
            color="green"
            tooltip="View"
            onClick={() => onView(r)}
          />
          <ActionButton
            icon={Pencil}
            color="blue"
            tooltip="Edit"
            onClick={() => onEdit(r)}
          />
          <ActionButton
            icon={Trash2}
            color="red"
            tooltip="Delete"
            onClick={() => onDelete(r)}
          />
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    );
  }

  return (
    <Table
      columns={columns}
      rows={rows}
      rowKey={(r) => r.institution_id}
      empty={
        <EmptyState
          icon="building"
          title="No institutions yet"
          description="Add your first institution to start managing programs."
        />
      }
    />
  );
}

// local cn to avoid an extra import in this file
function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}
