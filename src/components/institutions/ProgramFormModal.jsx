// src/components/institutions/ProgramFormModal.jsx
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

/**
 * Create / edit a single program for a fixed institution.
 * Duplicate detection (within the institution): program_name, program_code, abbreviation.
 */
export default function ProgramFormModal({
  open,
  editing,
  institutionId,
  existing = [], // programs of this institution (for duplicate checks)
  onClose,
  onSubmit,
  saving,
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    defaultValues: { program_name: "", abbreviation: "", program_code: "", required_hours: 300 },
  });

  useEffect(() => {
    if (!open) return;
    reset(
      editing
        ? {
            program_name: editing.program_name ?? "",
            abbreviation: editing.abbreviation ?? "",
            program_code: editing.program_code ?? "",
            required_hours: editing.required_hours ?? 300,
          }
        : { program_name: "", abbreviation: "", program_code: "", required_hours: 300 },
    );
  }, [open, editing, reset]);

  const onValid = (values) => {
    onSubmit({
      ...values,
      institution_id: institutionId,
      program_name: values.program_name.trim(),
      abbreviation: values.abbreviation.trim() || null,
      program_code: values.program_code.trim() || null,
      required_hours: Number(values.required_hours) || 0,
    });
  };

  const others = editing
    ? existing.filter((p) => p.program_id !== editing.program_id)
    : existing;

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
        <Input
          label="Program Name"
          required
          error={errors.program_name?.message}
          {...register("program_name", {
            required: "Program name is required",
            validate: (v) => {
              const name = v.trim().toLowerCase();
              return others.some((p) => p.program_name.toLowerCase() === name)
                ? "A program with this name already exists for this institution"
                : true;
            },
          })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Abbreviation" maxLength={10}
            error={errors.abbreviation?.message}
            {...register("abbreviation", {
              validate: (v) => {
                const a = v.trim().toLowerCase();
                return a && others.some((p) => (p.abbreviation || "").toLowerCase() === a)
                  ? "A program with this abbreviation already exists"
                  : true;
              },
            })}
          />
          <Input
            label="Program Code" maxLength={15}
            error={errors.program_code?.message}
            {...register("program_code", {
              validate: (v) => {
                const c = v.trim().toLowerCase();
                return c && others.some((p) => (p.program_code || "").toLowerCase() === c)
                  ? "A program with this code already exists"
                  : true;
              },
            })}
          />
        </div>
        <Input
          label="Required Internship Hours" maxLength={5}
          type="number"
          min={1}
          required
          error={errors.required_hours?.message}
          {...register("required_hours", {
            required: "Required hours is required",
            min: { value: 1, message: "Must be greater than 0" },
            valueAsNumber: true,
          })}
        />
      </form>
    </Modal>
  );
}
