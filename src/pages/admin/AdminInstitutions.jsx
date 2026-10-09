// src/pages/admin/AdminInstitutions.jsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import Spinner from "@/components/ui/Spinner";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Pagination from "@/components/ui/Pagination";
import InstitutionTable from "@/components/institutions/InstitutionTable";
import InstitutionModal from "@/components/institutions/InstitutionModal";
import { institutionService } from "@/services/institutionService";
import { programService } from "@/services/programService";
import { internService } from "@/services/internService";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

const PAGE_SIZE = 8;

export default function AdminInstitutions() {
  const navigate = useNavigate();

  const [institutions, setInstitutions] = useState([]); // enriched with counts
  const [instLoading, setInstLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ key: "institution_name", dir: "asc" });
  const [page, setPage] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingInst, setEditingInst] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [editLoading, setEditLoading] = useState(false);

  const debouncedSearch = useDebouncedValue(search, 500);

  // Single load: institutions + program/internship counts merged once.
  // Avoids the previous infinite loop (writing back into `institutions`
  // inside an effect that depended on `institutions`).
  const refresh = useCallback(async () => {
    setInstLoading(true);
    try {
      const [insts, progs, ints] = await Promise.all([
        institutionService.list({ search: debouncedSearch }),
        programService.list({}),
        internService.list({ pageSize: 1000 }),
      ]);
      const progByInst = new Map();
      progs.forEach((p) => {
        progByInst.set(p.institution_id, (progByInst.get(p.institution_id) || 0) + 1);
      });
      const activeByInst = new Map();
      (ints.data || []).forEach((i) => {
        if (i.status === "active" && i.institution_id) {
          activeByInst.set(i.institution_id, (activeByInst.get(i.institution_id) || 0) + 1);
        }
      });
      setInstitutions(
        insts.map((inst) => ({
          ...inst,
          program_count: progByInst.get(inst.institution_id) || 0,
          active_intern_count: activeByInst.get(inst.institution_id) || 0,
        })),
      );
    } catch (err) {
      toast.error(err.message);
    } finally {
      setInstLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => setPage(1), [debouncedSearch, sort]);

  const sorted = useMemo(() => {
    const arr = [...institutions];
    const { key, dir } = sort;
    arr.sort((a, b) => {
      let av = a[key];
      let bv = b[key];
      if (key === "updated_at") {
        av = av ? new Date(av).getTime() : 0;
        bv = bv ? new Date(bv).getTime() : 0;
      } else {
        av = av ?? 0;
        bv = bv ?? 0;
      }
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [institutions, sort]);

  const total = sorted.length;
  const rows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function onSort(key) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  }

  function openCreate() {
    setEditingInst(null);
    setModalOpen(true);
  }

  // Load the institution's programs so the modal can pre-populate them.
  // Without this, saving would reconcile with an empty list and DELETE all
  // existing programs.
  async function openEdit(inst) {
    setEditLoading(true);
    try {
      const programs = await programService.list({ institutionId: inst.institution_id });
      setEditingInst({ ...inst, programs });
      setModalOpen(true);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setEditLoading(false);
    }
  }

  async function onModalSubmit({ institution, programs, logoFile }) {
    setSaving(true);
    try {
      let institutionId;
      let logoUrl = institution.logo_url ?? null;
      if (editingInst) {
        await institutionService.update(editingInst.institution_id, institution);
        institutionId = editingInst.institution_id;
        toast.success("Institution updated.");
      } else {
        const created = await institutionService.create(institution);
        institutionId = created.institution_id;
        toast.success("Institution added.");
      }
      // Upload logo (if a new file was chosen) and persist its URL.
      if (logoFile) {
        try {
          logoUrl = await institutionService.uploadLogo(logoFile, institutionId);
          await institutionService.update(institutionId, { logo_url: logoUrl });
        } catch (e) {
          toast.error("Institution saved, but logo upload failed: " + e.message);
        }
      }
      await programService.reconcile(institutionId, programs);
      setModalOpen(false);
      await refresh();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      await institutionService.remove(toDelete.institution_id);
      toast.success("Institution deleted (programs removed too).");
      setToDelete(null);
      await refresh();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Institutions"
        description="Manage educational institutions, their academic programs, and linked interns."
        action={<Button onClick={openCreate}>+ Add Institution</Button>}
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-brand-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-base font-semibold text-slate-800">Institution Management</h3>
          <Input
            placeholder="Search institutions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
        </div>

        {instLoading ? (
          <Spinner label="Loading institutions…" />
        ) : (
          <InstitutionTable
            rows={rows}
            sort={sort}
            onSort={onSort}
            onEdit={openEdit}
            onDelete={setToDelete}
            onView={(r) => navigate(`/admin/institutions/${r.institution_id}`)}
          />
        )}

        {editLoading && (
          <div className="px-5 py-3 text-sm text-slate-500">Loading programs…</div>
        )}

        {!instLoading && total > PAGE_SIZE && (
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        )}
      </Card>

      <InstitutionModal
        open={modalOpen}
        editing={editingInst}
        existing={institutions}
        onClose={() => setModalOpen(false)}
        onSubmit={onModalSubmit}
        saving={saving}
      />

      <ConfirmDialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        onConfirm={confirmDelete}
        title="Delete institution?"
        message="This will also delete all programs linked to this institution. This cannot be undone."
        confirmLabel="Delete"
        loading={deleting}
      />
    </div>
  );
}
