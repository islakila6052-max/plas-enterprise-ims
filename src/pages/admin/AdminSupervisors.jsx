// src/pages/admin/AdminSupervisors.jsx
import { useEffect, useState, useCallback } from "react";
import { toast } from "react-hot-toast";
import { useForm } from "react-hook-form";
import { Pencil, Trash2, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/lib/supabase";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import Card from "@/components/ui/Card";
import Table from "@/components/ui/Table";
import Modal from "@/components/ui/Modal";
import Spinner from "@/components/ui/Spinner";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ActionButton from "@/components/ui/ActionButton";
import PasswordStrengthMeter, {
  getPasswordIssue,
} from "@/components/ui/PasswordStrengthMeter";
import { departmentService } from "@/services/departmentService";
import { supervisorService } from "@/services/supervisorService";
import { userService } from "@/services/userService";
import { useAuth } from "@/contexts/AuthContext";
import { formatDate } from "@/utils/format";
import {
  recordAudit,
  notify,
  notifyAllWithType,
  auditDiff,
  auditCreated,
  auditDeleted,
} from "@/services/activityService"; // ✅ Fixed import

export default function AdminSupervisors() {
  const { user } = useAuth();
  const [supervisors, setSupervisors] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm({
    defaultValues: {
      first_name: "",
      last_name: "",
      email: "",
      password: "",
      department_id: "",
    },
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let supData = [];
      let deptData = [];

      try {
        supData = await supervisorService.list();
      } catch (err) {
        toast.error("Failed to load supervisors: " + err.message);
      }

      try {
        deptData = await departmentService.list();
      } catch (err) {
        toast.error("Failed to load departments: " + err.message);
      }

      setSupervisors(supData);
      setDepartments(deptData);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    reset({
      first_name: "",
      last_name: "",
      email: "",
      password: "",
      department_id: "",
    });
    setModalOpen(true);
  }

  function openEdit(sup) {
    setEditing(sup);
    reset({
      first_name: sup.first_name || "",
      last_name: sup.last_name || "",
      email: sup.email || sup.profile?.email || "",
      password: "",
      department_id: sup.department_id || "",
    });
    setModalOpen(true);
  }

  async function onSubmit(values) {
    setSaving(true);
    try {
      // profiles/auth keep a single combined full_name; the supervisors table
      // stores first_name / last_name separately.
      const fullName =
        [values.first_name, values.last_name].filter(Boolean).join(" ").trim() ||
        "New supervisor";
      if (editing) {
        await supervisorService.update(editing.id, {
          first_name: values.first_name,
          last_name: values.last_name,
          email: values.email,
          department_id: values.department_id,
        });
        await recordAudit({
          user_id: user?.id,
          action: "update",
          resource_type: "supervisor",
          resource_id: editing.id,
          changes: auditDiff(
            {
              first_name: editing.first_name ?? null,
              last_name: editing.last_name ?? null,
              email: editing.email ?? null,
              department_id: editing.department_id ?? null,
            },
            {
              first_name: values.first_name ?? null,
              last_name: values.last_name ?? null,
              email: values.email ?? null,
              department_id: values.department_id || null,
            },
          ),
        });

        // Notify the supervisor their account was updated.
        if (editing.profile_id) {
          await notify({
            user_id: editing.profile_id,
            type: "account_created",
            title: "Your account was updated",
            message: `${fullName}, your supervisor account details were updated by an admin.`,
            link: "/supervisor",
          }).catch(() => {});
        }

        toast.success("Supervisor updated.");
      } else {
        const newUser = await userService.createAuthUser({
          email: values.email,
          password: values.password,
          full_name: fullName,
          role: "supervisor",
        });

        if (supabase && newUser?.id) {
          await supabase
            .from("profiles")
            .update({
              role: "supervisor",
              full_name: fullName,
            })
            .eq("id", newUser.id);
        } else if (!newUser?.id) {
          throw new Error(
            "User creation did not return an id. Check the create-user API response.",
          );
        }

        await supervisorService.create({
          profile_id: newUser.id,
          department_id: values.department_id,
          first_name: values.first_name,
          last_name: values.last_name,
          email: values.email,
          created_by: user?.id,
        });

        await recordAudit({
          user_id: user?.id,
          action: "create",
          resource_type: "supervisor",
          resource_id: newUser?.id,
          changes: auditCreated({
            first_name: values.first_name,
            last_name: values.last_name,
            email: values.email,
            department_id: values.department_id,
          }),
        });

        // ✅ Add notifications
        if (newUser?.id) {
          await notify({
            user_id: newUser.id,
            type: "account_created",
            title: "Your supervisor account is ready",
            message: `Welcome ${fullName}! You have been created as a supervisor. You can now log in and manage interns.`,
            link: "/supervisor",
          });
        }

        await notifyAllWithType({
          type: "announcement",
          title: "New supervisor created",
          message: `${fullName} has been created as a new supervisor.`,
          link: "/admin/supervisors",
          metadata: {
            supervisor_id: newUser?.id,
            supervisor_name: fullName,
          },
        });

        toast.success(`Supervisor ${fullName} created successfully!`);
      }
      setModalOpen(false);
      load();
    } catch (err) {
      const message = String(err?.message || "");
      const lower = message.toLowerCase();
      if (
        lower.includes("already registered") ||
        lower.includes("already exists") ||
        lower.includes("duplicate")
      ) {
        toast.error(
          "This email is already registered to an existing account. Please use a different (unique) email for this supervisor.",
        );
      } else {
        toast.error(message);
      }
    } finally {
      setSaving(false);
    }
  }

  async function removeSupervisor() {
    setDeleting(true);
    try {
      await supervisorService.remove(confirm.id);
      await recordAudit({
        user_id: user?.id,
        action: "delete",
        resource_type: "supervisor",
        resource_id: confirm.id,
        // Snapshot of the values that existed before deletion.
        changes: auditDeleted({
          full_name: confirm?.full_name || confirm?.profile?.full_name,
          email: confirm?.email,
          department_id: confirm?.department_id,
        }),
      });
      toast.success("Supervisor removed.");
      setConfirm(null);
      load();
    } catch (err) {
      toast.error(err.message);
      setConfirm(null);
    } finally {
      setDeleting(false);
    }
  }

  const columns = [
    {
      key: "full_name",
      header: "Name",
      render: (r) => r.profile?.full_name || r.full_name || "—",
    },
    {
      key: "email",
      header: "Email",
      render: (r) => r.profile?.email || r.email || "—",
    },
    {
      key: "department",
      header: "Department",
      render: (r) => r.department?.name || "Unassigned",
    },
    {
      key: "created_at",
      header: "Created",
      render: (r) => formatDate(r.created_at),
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
            onClick={() => openEdit(r)}
          />
          <ActionButton
            icon={Trash2}
            color="red"
            tooltip="Delete"
            onClick={() => setConfirm(r)}
          />
        </div>
      ),
    },
  ];

  // Live password requirement feedback — recomputed on every keystroke via
  // watch(), so the failing requirement shows while typing (not only after
  // the Create button is pressed).
  const watchedPassword = watch("password");
  const passwordIssue = getPasswordIssue(watchedPassword);

  return (
    <div>
      <PageHeader
        title="Supervisor Management"
        description="Create and manage department supervisors."
        action={<Button onClick={openCreate}>+ Create Supervisor</Button>}
      />

      <Card>
        {loading ? (
          <Spinner label="Loading supervisors..." />
        ) : (
          <Table
            columns={columns}
            rows={supervisors}
            rowKey={(r) => r.id}
            empty={
              <div className="p-4 text-center text-sm text-slate-500">
                No supervisors created yet.
              </div>
            }
          />
        )}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        size="md"
        title={editing ? "Edit Supervisor" : "Create Supervisor"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit(onSubmit)} loading={saving}>
              {editing ? "Update" : "Create"}
            </Button>
          </>
        }>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <Input
            label="First name"
            maxLength={35}
            error={errors.first_name?.message}
            {...register("first_name", {
              required: "First name is required",
            })}
          />
          <Input
            label="Last name"
            maxLength={35}
            error={errors.last_name?.message}
            {...register("last_name", {
              required: "Last name is required",
            })}
          />
          <Input
            label="Email"
            type="email"
            maxLength={100}
            error={errors.email?.message}
            {...register("email", {
              required: "Email is required",
              pattern: {
                value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                message: "Enter a valid email",
              },
            })}
          />
          {!editing && (
            <div>
              <Input
                label="Temporary Password"
                type={showPassword ? "text" : "password"}
                maxLength={72}
                placeholder="Example#123"
                error={passwordIssue || errors.password?.message}
                rightIcon={
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    title={showPassword ? "Hide password" : "Show password"}
                    className="rounded p-1 text-slate-400 transition hover:text-slate-600">
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                }
                {...register("password", {
                  required: "Password is required",
                  // H6: must match the server-side policy exactly (12+ chars,
                  // upper, lower, digit) or the API rejects the request after
                  // the user has already filled in the whole form.
                  minLength: {
                    value: 12,
                    message: "Password must be at least 12 characters",
                  },
                  pattern: {
                    value: /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{12,}$/,
                    message: "Needs uppercase, lowercase and a number",
                  },
                })}
              />
              {/* Live strength line: fills and changes color as the password
                  meets each requirement (8+ chars, upper, lower, number,
                  symbol) — matches the Add Intern password field. */}
              <PasswordStrengthMeter password={watchedPassword} />
            </div>
          )}
          <Select
            label="Department"
            error={errors.department_id?.message}
            {...register("department_id", {
              required: "Department is required",
            })}>
            <option value="">Select Department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          {!editing && (
            <p className="text-xs text-slate-500">
              Supervisors can view and manage their assigned interns.
            </p>
          )}
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={removeSupervisor}
        title="Delete Supervisor?"
        message={`Delete ${confirm?.full_name || confirm?.profile?.full_name}? This removes the supervisor and ALL their evaluations, journals, and notifications, disables their login, and unassigns their interns (intern records are kept). This cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
        loading={deleting}
      />
    </div>
  );
}
