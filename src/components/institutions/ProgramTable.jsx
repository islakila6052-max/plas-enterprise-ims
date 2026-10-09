// src/components/institutions/ProgramTable.jsx
import { Pencil, Trash2 } from "lucide-react";
import Table from "@/components/ui/Table";
import ActionButton from "@/components/ui/ActionButton";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";

/** Table of programs for a given institution (or all), with row actions. */
export default function ProgramTable({
  rows,
  onEdit,
  onDelete,
  loading,
  institutionName,
}) {
  const columns = [
    {
      key: "program_name",
      header: "Program Name",
      render: (r) => r.program_name,
    },
    {
      key: "institution",
      header: "Institution",
      render: (r) => r.institution?.institution_name ?? institutionName ?? "—",
    },
    {
      key: "abbreviation",
      header: "Abbreviation",
      render: (r) => r.abbreviation || "—",
    },
    {
      key: "hours_to_render",
      header: "Hours to Render",
      render: (r) => `${r.hours_to_render ?? 0} hrs`,
    },
    {
      key: "moa",
      header: "MOA",
      render: (r) =>
        r.memo_of_agreement ? (
          <Badge tone="green">Uploaded</Badge>
        ) : (
          <Badge tone="gray">None</Badge>
        ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (r) => (
        <div className="flex items-center justify-center gap-1">
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
          <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    );
  }

  return (
    <Table
      columns={columns}
      rows={rows}
      rowKey={(r) => r.program_id}
      empty={
        <EmptyState
          icon="book"
          title="No programs yet"
          description="Add a program under this institution."
        />
      }
    />
  );
}
