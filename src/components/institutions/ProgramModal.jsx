// src/components/institutions/ProgramModal.jsx
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";

/**
 * Create / edit program form.
 * @param {object} props
 * @param {boolean} props.open
 * @param {object|null} props.editing   program row when editing
 * @param {Array}  props.institutions    list of institutions for the dropdown
 * @param {string} props.defaultInstitutionId  preselected institution (when adding from an institution)
 * @param {Array}  props.existing        programs of the selected institution (duplicate check)
 * @param {Function} props.onClose
 * @param {Function} props.onSubmit      async ({ values, file }) => void
 * @param {boolean} props.saving
 */
export default function ProgramModal({
  open,
  editing,
  institutions = [],
  defaultInstitutionId = "",
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
      institution_id: defaultInstitutionId,
      program_name: "",
      abbreviation: "",
      hours_to_render: 300,
    },
  });

  const [file, setFile] = useState(null);
  const selectedInstitution = watch("institution_id");

  useEffect(() => {
    if (open) {
      setFile(null);
      reset(
        editing
          ? {
              institution_id: editing.institution_id ?? defaultInstitutionId,
              program_name: editing.program_name ?? "",
              abbreviation: editing.abbreviation ?? "",
              hours_to_render: editing.hours_to_render ?? 300,
            }
          : {
              institution_id: defaultInstitutionId,
              program_name: "",
              abbreviation: "",
              hours_to_render: 300,
            },
      );
    }
  }, [open, editing, defaultInstitutionId, reset]);

  const onValid = (values) => {
    onSubmit({ values, file });
  };

  const programsForSelected = editing
    ? existing
    : existing.filter((p) => p.institution_id === selectedInstitution);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit Program" : "Add Program"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit(onValid)} loading={saving}>
            {editing ? "Save Changes" : "Create Program"}
          </Button>
        </>
      }>
      <form className="space-y-4" onSubmit={handleSubmit(onValid)}>
        <Select label="Institution" {...register("institution_id", { required: "Institution is required" })}>
          <option value="">Select institution…</option>
          {institutions.map((i) => (
            <option key={i.institution_id} value={i.institution_id}>
              {i.institution_name}
            </option>
          ))}
        </Select>
        <Input
          label="Program Name"
          error={errors.program_name?.message}
          {...register("program_name", {
            required: "Program name is required",
            validate: (v) => {
              const name = v.trim().toLowerCase();
              const dup = programsForSelected.some(
                (p) =>
                  p.program_name.toLowerCase() === name &&
                  p.program_id !== editing?.program_id,
              );
              return dup ? "A program with this name already exists for this institution" : true;
            },
          })}
        />
        <Input label="Abbreviation" {...register("abbreviation")} />
        <Input
          label="Hours to Render"
          type="number"
          min={1}
          error={errors.hours_to_render?.message}
          {...register("hours_to_render", {
            required: "Hours to render is required",
            min: { value: 1, message: "Must be a positive number" },
            valueAsNumber: true,
          })}
        />
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Memorandum of Agreement (PDF)
          </label>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
          />
          {editing?.memo_of_agreement && !file && (
            <p className="mt-1 text-xs text-slate-400">
              Current MOA is already uploaded. Choose a new file to replace it.
            </p>
          )}
        </div>
      </form>
    </Modal>
  );
}
