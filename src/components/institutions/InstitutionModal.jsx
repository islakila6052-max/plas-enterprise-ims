// src/components/institutions/InstitutionModal.jsx
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Icon } from "@/components/ui/icons";
import Avatar from "@/components/ui/Avatar";
import { institutionService } from "@/services/institutionService";

/**
 * Create / edit institution, with an inline multi-program editor.
 *
 * The admin can add as many programs as needed before saving. On submit we send
 * the institution values plus the full program list; the page handler inserts
 * the institution then reconciles the programs (insert/update/delete).
 *
 * Duplicate detection (client-side, mirrors DB constraints):
 *  - institution_name must be unique among `existing` institutions
 *  - program_name must be unique within this institution
 *  - program_code must be unique (across the institution)
 *  - abbreviation must be unique within this institution
 */
export default function InstitutionModal({
  open,
  editing,
  existing = [],
  onClose,
  onSubmit,
  saving,
}) {
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm({
    defaultValues: {
      institution_name: "",
      abbreviation: "",
      campus: "",
      address: "",
      contact_person: "",
      contact_number: "",
      email: "",
    },
  });

  const watchName = watch("institution_name");

  // Logo: existing URL (editing) + a pending File to upload on save.
  const [logoUrl, setLogoUrl] = useState("");
  const [logoFile, setLogoFile] = useState(null);
  const [logoError, setLogoError] = useState("");

  // Programs being edited inline, and any per-row validation errors.
  const [programs, setPrograms] = useState([]);
  const [progErrors, setProgErrors] = useState({});

  useEffect(() => {
    if (!open) return;
    reset(
      editing
        ? {
            institution_name: editing.institution_name ?? "",
            abbreviation: editing.abbreviation ?? "",
            campus: editing.campus ?? "",
            address: editing.address ?? "",
            contact_person: editing.contact_person ?? "",
            contact_number: editing.contact_number ?? "",
            email: editing.email ?? "",
          }
        : {
            institution_name: "",
            abbreviation: "",
            campus: "",
            address: "",
            contact_person: "",
            contact_number: "",
            email: "",
          },
    );
    setPrograms(
      editing?.programs
        ? editing.programs.map((p) => ({
            program_id: p.program_id,
            program_name: p.program_name ?? "",
            abbreviation: p.abbreviation ?? "",
            program_code: p.program_code ?? "",
            required_hours: p.required_hours ?? 300,
          }))
        : [],
    );
    setLogoUrl(editing?.logo_url ?? "");
    setLogoFile(null);
    setLogoError("");
    setProgErrors({});
  }, [open, editing, reset]);

  const addProgram = () => {
    setPrograms((prev) => [
      ...prev,
      { program_name: "", abbreviation: "", program_code: "", required_hours: 300 },
    ]);
  };

  const updateProgram = (idx, key, val) => {
    setPrograms((prev) => prev.map((p, i) => (i === idx ? { ...p, [key]: val } : p)));
  };

  const removeProgram = (idx) => {
    setPrograms((prev) => prev.filter((_, i) => i !== idx));
  };

  // Validate programs (duplicate detection + required fields).
  const validatePrograms = useMemo(() => {
    const errs = {};
    const seenName = new Map();
    const seenCode = new Map();
    const seenAbbr = new Map();
    programs.forEach((p, idx) => {
      const e = {};
      if (!p.program_name?.trim()) e.program_name = "Program name is required";
      else {
        const key = p.program_name.trim().toLowerCase();
        if (seenName.has(key)) e.program_name = "Duplicate program name";
        else seenName.set(key, idx);
      }
      if (p.program_code?.trim()) {
        const key = p.program_code.trim().toLowerCase();
        if (seenCode.has(key)) e.program_code = "Duplicate program code";
        else seenCode.set(key, idx);
      }
      if (p.abbreviation?.trim()) {
        const key = p.abbreviation.trim().toLowerCase();
        if (seenAbbr.has(key)) e.abbreviation = "Duplicate abbreviation";
        else seenAbbr.set(key, idx);
      }
      if (!p.required_hours || Number(p.required_hours) <= 0)
        e.required_hours = "Hours must be greater than 0";
      if (Object.keys(e).length) errs[idx] = e;
    });
    return errs;
  }, [programs]);

  const onValid = (values) => {
    const name = values.institution_name.trim();
    const dupInst = existing.some(
      (i) =>
        i.institution_name.toLowerCase() === name.toLowerCase() &&
        i.institution_id !== editing?.institution_id,
    );
    if (dupInst) {
      // Surface as a field error.
      return;
    }
    const pErrs = validatePrograms;
    if (Object.keys(pErrs).length) {
      setProgErrors(pErrs);
      return;
    }
    setProgErrors({});
    // Pass the logo state up; the page handler uploads the file (needs the
    // institution id) and then saves logo_url.
    onSubmit({
      institution: { ...values, institution_name: name, logo_url: logoFile ? null : logoUrl },
      programs: programs.map((p) => ({
        ...p,
        program_name: p.program_name.trim(),
        abbreviation: p.abbreviation.trim() || null,
        program_code: p.program_code.trim() || null,
        required_hours: Number(p.required_hours) || 0,
      })),
      logoFile: logoFile || null,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={editing ? "Edit Institution" : "Add Institution"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit(onValid)} loading={saving}>
            {editing ? "Save Changes" : "Create Institution"}
          </Button>
        </>
      }>
      <form className="space-y-6" onSubmit={handleSubmit(onValid)}>
        {/* Institution Information */}
        <section className="space-y-4">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Institution Information
          </h4>

          {/* Logo uploader */}
          <div className="flex items-center gap-4">
            <Avatar src={logoUrl || undefined} name={watchName} size="lg" />
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Logo / Avatar
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="inst-logo"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (!f.type.startsWith("image/")) {
                      setLogoError("Please choose an image file");
                      return;
                    }
                    setLogoError("");
                    setLogoFile(f);
                    setLogoUrl(URL.createObjectURL(f));
                  }}
                />
                <Button type="button" size="sm" variant="outline" onClick={() => document.getElementById("inst-logo")?.click()}>
                  {logoUrl ? "Change" : "Upload"}
                </Button>
                {logoUrl && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-red-600 hover:bg-red-50"
                    onClick={() => {
                      setLogoUrl("");
                      setLogoFile(null);
                    }}>
                    Remove
                  </Button>
                )}
              </div>
              {logoError && <p className="mt-1 text-xs font-medium text-red-600">{logoError}</p>}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Institution Name" maxLength={150}
              required
              error={errors.institution_name?.message}
              {...register("institution_name", {
                required: "Institution name is required",
                validate: (v) => {
                  const name = v.trim().toLowerCase();
                  const dup = existing.some(
                    (i) =>
                      i.institution_name.toLowerCase() === name &&
                      i.institution_id !== editing?.institution_id,
                  );
                  return dup ? "An institution with this name already exists" : true;
                },
              })}
            />
            <Input label="Abbreviation" maxLength={10} {...register("abbreviation")} />
            <Input label="Campus" {...register("campus")} />
            <Input label="Address" {...register("address")} />
            <Input label="Contact Person (optional)" {...register("contact_person")} />
            <Input label="Contact Number (optional)" {...register("contact_number")} />
            <Input label="Email (optional)" type="email" {...register("email")} />
          </div>
        </section>

        {/* Programs */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Programs ({programs.length})
            </h4>
            <Button type="button" size="sm" variant="outline" onClick={addProgram}>
              + Add Program
            </Button>
          </div>

          {programs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              No programs yet. Add at least one program for this institution.
            </div>
          ) : (
            <div className="space-y-3">
              {programs.map((p, idx) => {
                const e = progErrors[idx] || {};
                return (
                  <div
                    key={idx}
                    className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:grid-cols-12 sm:items-start">
                    <div className="sm:col-span-4">
                      <Input
                        label="Program Name" maxLength={100}
                        placeholder="e.g. BS Information Technology"
                        value={p.program_name}
                        error={e.program_name}
                        onChange={(ev) => updateProgram(idx, "program_name", ev.target.value)}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Input
                        label="Abbreviation" maxLength={10}
                        placeholder="BSIT"
                        value={p.abbreviation}
                        error={e.abbreviation}
                        onChange={(ev) => updateProgram(idx, "abbreviation", ev.target.value)}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Input
                        label="Program Code"
                        placeholder="BSIT-01"
                        value={p.program_code}
                        error={e.program_code}
                        onChange={(ev) => updateProgram(idx, "program_code", ev.target.value)}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Input
                        label="Required Hours"
                        type="number"
                        min={1}
                        value={p.required_hours}
                        error={e.required_hours}
                        onChange={(ev) => updateProgram(idx, "required_hours", ev.target.value)}
                      />
                    </div>
                    <div className="flex items-end justify-end sm:col-span-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:bg-red-50"
                        onClick={() => removeProgram(idx)}
                        aria-label="Remove program">
                        <Icon name="close" className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </form>
    </Modal>
  );
}
