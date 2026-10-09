// src/pages/admin/InstitutionProfile.jsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import { Pencil, Trash2 } from "lucide-react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import StatCard from "@/components/ui/StatCard";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";
import EmptyState from "@/components/ui/EmptyState";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ActionButton from "@/components/ui/ActionButton";
import Pagination from "@/components/ui/Pagination";
import Table from "@/components/ui/Table";
import { Icon } from "@/components/ui/icons";
import ProgramFormModal from "@/components/institutions/ProgramFormModal";
import InstitutionModal from "@/components/institutions/InstitutionModal";
import { institutionService } from "@/services/institutionService";
import { programService } from "@/services/programService";
import { internService } from "@/services/internService";
import { formatDate } from "@/utils/format";

const PAGE_SIZE = 8;

export default function InstitutionProfile() {
  const { institutionId } = useParams();
  const navigate = useNavigate();

  const [institution, setInstitution] = useState(null);
  const [programs, setPrograms] = useState([]);
  const [interns, setInterns] = useState([]);
  const [loading, setLoading] = useState(true);

  const [progModalOpen, setProgModalOpen] = useState(false);
  const [editingProg, setEditingProg] = useState(null);
  const [savingProg, setSavingProg] = useState(false);
  const [progToDelete, setProgToDelete] = useState(null);
  const [deletingProg, setDeletingProg] = useState(false);
  const [progPage, setProgPage] = useState(1);
  const [instModalOpen, setInstModalOpen] = useState(false);
  const [savingInst, setSavingInst] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [inst, progs, ints] = await Promise.all([
        institutionService.getById(institutionId),
        programService.list({ institutionId }),
        internService.list({ institutionId, pageSize: 1000 }),
      ]);
      setInstitution(inst);
      setPrograms(progs);
      setInterns(ints.data || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [institutionId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => setProgPage(1), [programs]);

  const stats = useMemo(() => {
    const active = interns.filter((i) => i.status === "active").length;
    const completed = interns.filter((i) => i.status === "completed").length;
    const byProgram = new Map();
    interns.forEach((i) => {
      if (i.program_id)
        byProgram.set(i.program_id, (byProgram.get(i.program_id) || 0) + 1);
    });
    return {
      active,
      completed,
      ongoing: interns.filter(
        (i) => i.status === "active" || i.status === "completed",
      ).length,
      byProgram,
    };
  }, [interns]);

  const progRows = useMemo(
    () => programs.slice((progPage - 1) * PAGE_SIZE, progPage * PAGE_SIZE),
    [programs, progPage],
  );

  const programColumns = [
    {
      key: "program_name",
      header: "Program Name",
      render: (r) => r.program_name,
    },
    {
      key: "program_code",
      header: "Program Code",
      render: (r) => r.program_code || "—",
    },
    {
      key: "abbreviation",
      header: "Abbreviation",
      render: (r) => r.abbreviation || "—",
    },
    {
      key: "required_hours",
      header: "Required Hours",
      render: (r) => `${r.required_hours ?? 0} hrs`,
    },
    {
      key: "total_interns",
      header: "Total Interns",
      render: (r) => stats.byProgram.get(r.program_id) || 0,
    },
    {
      key: "status",
      header: "Status",
      render: (r) =>
        (stats.byProgram.get(r.program_id) || 0) > 0 ? (
          <Badge tone="green">Active</Badge>
        ) : (
          <Badge tone="gray">No interns</Badge>
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
            onClick={() => openEditProg(r)}
          />
          <ActionButton
            icon={Trash2}
            color="red"
            tooltip="Delete"
            onClick={() => setProgToDelete(r)}
          />
        </div>
      ),
    },
  ];

  function openAddProg() {
    setEditingProg(null);
    setProgModalOpen(true);
  }
  function openEditProg(r) {
    setEditingProg(r);
    setProgModalOpen(true);
  }

  async function onProgSubmit(values) {
    setSavingProg(true);
    try {
      if (editingProg) {
        await programService.update(editingProg.program_id, values);
        toast.success("Program updated.");
      } else {
        await programService.create(values);
        toast.success("Program added.");
      }
      setProgModalOpen(false);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingProg(false);
    }
  }

  async function onInstSubmit({ institution, programs, logoFile }) {
    setSavingInst(true);
    try {
      let logoUrl = institution.logo_url ?? null;
      await institutionService.update(institutionId, institution);
      if (logoFile) {
        try {
          logoUrl = await institutionService.uploadLogo(
            logoFile,
            institutionId,
          );
          await institutionService.update(institutionId, { logo_url: logoUrl });
        } catch (e) {
          toast.error(
            "Institution updated, but logo upload failed: " + e.message,
          );
        }
      }
      await programService.reconcile(institutionId, programs);
      toast.success("Institution updated.");
      setInstModalOpen(false);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingInst(false);
    }
  }
  async function confirmDeleteProg() {
    setDeletingProg(true);
    try {
      await programService.remove(progToDelete.program_id);
      toast.success("Program deleted.");
      setProgToDelete(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeletingProg(false);
    }
  }

  if (loading) return <Spinner label="Loading institution…" />;

  if (!institution) {
    return (
      <EmptyState
        icon="building"
        title="Institution not found"
        description="This institution may have been deleted."
        action={
          <Button onClick={() => navigate("/admin/institutions")}>
            Back to Institutions
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to="/admin/institutions"
        className="inline-flex items-center gap-1 text-sm text-slate-500 transition hover:text-brand-700">
        <Icon name="chevronDown" className="h-4 w-4 rotate-90" /> Back to
        Institutions
      </Link>

      {/* Header card */}
      <Card>
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <Avatar
            src={institution.logo_url}
            name={institution.institution_name}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-slate-800">
              {institution.institution_name}
            </h2>
            <p className="text-sm text-slate-500">
              {[institution.abbreviation, institution.campus]
                .filter(Boolean)
                .join(" · ") || "—"}
            </p>
            {institution.address && (
              <p className="mt-1 text-sm text-slate-500">
                {institution.address}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setInstModalOpen(true)}>
              Edit
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px border-t border-slate-100 bg-slate-100 sm:grid-cols-4">
          <InfoCell label="Contact Person" value={institution.contact_person} />
          <InfoCell label="Contact Number" value={institution.contact_number} />
          <InfoCell label="Email" value={institution.email} />
          <InfoCell
            label="Last Updated"
            value={formatDate(institution.updated_at)}
          />
        </div>
      </Card>

      {/* Statistics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Programs"
          value={programs.length}
          icon="book"
          tone="brand"
        />
        <StatCard
          label="Total Active Interns"
          value={stats.active}
          icon="users"
          tone="green"
        />
        <StatCard
          label="Total Completed Interns"
          value={stats.completed}
          icon="checkCircle"
          tone="blue"
        />
        <StatCard
          label="Total Ongoing Internships"
          value={stats.ongoing}
          icon="clock"
          tone="amber"
        />
      </div>

      {/* Interns by Program */}
      <Card>
        <div className="border-b border-brand-100 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-800">
            Interns by Program
          </h3>
        </div>
        {programs.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon="book"
              title="No programs"
              description="Add a program to see intern distribution."
            />
          </div>
        ) : (
          <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {programs.map((p) => (
              <div
                key={p.program_id}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {p.program_name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {p.abbreviation || p.program_code || "—"}
                  </p>
                </div>
                <span className="ml-3 shrink-0 rounded-full bg-brand-100 px-3 py-1 text-sm font-semibold text-brand-700">
                  {stats.byProgram.get(p.program_id) || 0}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Programs table */}
      <Card>
        <div className="flex flex-col gap-3 border-b border-brand-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-base font-semibold text-slate-800">Programs</h3>
          <Button onClick={openAddProg}>+ Add Program</Button>
        </div>
        {programs.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon="book"
              title="No programs yet"
              description="Add a program under this institution."
            />
          </div>
        ) : (
          <>
            <Table
              columns={programColumns}
              rows={progRows}
              rowKey={(r) => r.program_id}
            />
            {programs.length > PAGE_SIZE && (
              <Pagination
                page={progPage}
                pageSize={PAGE_SIZE}
                total={programs.length}
                onPageChange={setProgPage}
              />
            )}
          </>
        )}
      </Card>

      <ProgramFormModal
        open={progModalOpen}
        editing={editingProg}
        institutionId={institutionId}
        existing={programs}
        onClose={() => setProgModalOpen(false)}
        onSubmit={onProgSubmit}
        saving={savingProg}
      />

      <InstitutionModal
        open={instModalOpen}
        editing={{ ...institution, programs }}
        existing={[]}
        onClose={() => setInstModalOpen(false)}
        onSubmit={onInstSubmit}
        saving={savingInst}
      />

      <ConfirmDialog
        open={Boolean(progToDelete)}
        onClose={() => setProgToDelete(null)}
        onConfirm={confirmDeleteProg}
        title="Delete program?"
        message="This action cannot be undone."
        confirmLabel="Delete"
        loading={deletingProg}
      />
    </div>
  );
}

function InfoCell({ label, value }) {
  return (
    <div className="bg-white px-5 py-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="truncate text-sm font-medium text-slate-700">
        {value || "—"}
      </p>
    </div>
  );
}
