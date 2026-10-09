// src/pages/admin/InternManagement.jsx
import { useEffect, useState, useCallback } from "react";
import { toast } from "react-hot-toast";
import { useForm } from "react-hook-form";
import { Pencil, Archive, RotateCcw, Trash2, Eye, EyeOff } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import Card from "@/components/ui/Card";
import Table from "@/components/ui/Table";
import Modal from "@/components/ui/Modal";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";
import EmptyState from "@/components/ui/EmptyState";
import Pagination from "@/components/ui/Pagination";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ActionButton from "@/components/ui/ActionButton";
import PasswordStrengthMeter, {
  getPasswordIssue,
} from "@/components/ui/PasswordStrengthMeter";
import Avatar from "@/components/ui/Avatar";
import SearchableSelect from "@/components/ui/SearchableSelect";
import { internService } from "@/services/internService";
import { departmentService } from "@/services/departmentService";
import { supervisorService } from "@/services/supervisorService";
import { institutionService } from "@/services/institutionService";
import { programService } from "@/services/programService";
import { userService } from "@/services/userService";
import { useAuth } from "@/contexts/AuthContext";
import {
  INTERN_STATUS,
  INTERN_STATUS_LABELS,
  PAGE_SIZE,
} from "@/lib/constants";
import { formatDate } from "@/utils/format";
import { logger } from "@/lib/logger";
import {
  recordAudit,
  notify,
  auditDiff,
  auditDeleted,
} from "@/services/activityService";

const STATUS_TONE = { active: "green", completed: "blue", archived: "gray" };

const EMPTY = {
  first_name: "",
  last_name: "",
  contact_number: "",
  email: "",
  emergency_contact: "",
  department_id: "",
  supervisor_id: "",
  start_date: "",
  end_date: "",
  required_hours: 300,
  status: "active",
};

export default function InternManagement() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [status, setStatus] = useState("");

  const [departments, setDepartments] = useState([]);
  const [supervisors, setSupervisors] = useState([]);
  const [institutions, setInstitutions] = useState([]);
  const [selectedInstitutionId, setSelectedInstitutionId] = useState("");
  const [institutionLabel, setInstitutionLabel] = useState("");
  const [selectedProgramId, setSelectedProgramId] = useState("");
  const [programLabel, setProgramLabel] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [detail, setDetail] = useState(null);
  const [confirm, setConfirm] = useState(null); // { type, row }
  const [confirming, setConfirming] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm({ defaultValues: EMPTY });

  // Live values for cross-field date validation. Both date fields are optional
  // individually, but when both are present the end date must not precede the
  // start date — without this, an intern can be saved with an end date that is
  // years before their start date (this actually happened in the live data).
  const watchStartDate = () => watch("start_date") || "";
  const watchEndDate = () => watch("end_date") || "";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await internService.list({
        search,
        departmentId,
        status,
        page,
      });
      setRows(res.data);
      setTotal(res.count);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [search, departmentId, status, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    departmentService
      .list()
      .then(setDepartments)
      .catch(() => {});
    supervisorService
      .list()
      .then(setSupervisors)
      .catch(() => {});
    institutionService
      .list({})
      .then(setInstitutions)
      .catch(() => {});
  }, []);

  // Supervisors filtered by the chosen department. Drives the Supervisor
  // dropdown so an intern can only be assigned to a supervisor in the same
  // department. Recomputes immediately whenever the department selection changes.
  const selectedDepartmentId = watch("department_id");
  const filteredSupervisors = selectedDepartmentId
    ? supervisors.filter((s) => s.department_id === selectedDepartmentId)
    : [];

  function openCreate() {
    setEditing(null);
    reset(EMPTY);
    setSelectedInstitutionId("");
    setInstitutionLabel("");
    setSelectedProgramId("");
    setProgramLabel("");
    setModalOpen(true);
  }

  function openEdit(row) {
    setEditing(row);
    reset({
      first_name: row.first_name ?? "",
      last_name: row.last_name ?? "",
      contact_number: row.contact_number ?? "",
      email: row.email ?? "",
      emergency_contact: row.emergency_contact ?? "",
      department_id: row.department_id ?? "",
      supervisor_id: row.supervisor_id ?? "",
      start_date: row.start_date ?? "",
      end_date: row.end_date ?? "",
      required_hours: row.required_hours ?? 300,
      status: row.status ?? "active",
    });
    setSelectedInstitutionId(row.institution_id ?? "");
    setInstitutionLabel(
      institutions.find((i) => i.institution_id === row.institution_id)
        ?.institution_name ?? "",
    );
    setSelectedProgramId(row.program_id ?? "");
    setProgramLabel("");
    if (row.institution_id) {
      programService
        .list({ institutionId: row.institution_id })
        .then((ps) => {
          const p = ps.find((x) => x.program_id === row.program_id);
          setProgramLabel(p?.program_name ?? "");
        })
        .catch(() => {});
    }
    setModalOpen(true);
  }

  async function onInstitutionSearch(query) {
    try {
      const rows = await institutionService.list({ search: query });
      return rows.map((i) => ({
        value: i.institution_id,
        label: i.institution_name,
      }));
    } catch {
      return [];
    }
  }

  async function onProgramSearch(query) {
    if (!selectedInstitutionId) return [];
    try {
      const rows = await programService.list({
        institutionId: selectedInstitutionId,
        search: query,
      });
      return rows.map((p) => ({ value: p.program_id, label: p.program_name }));
    } catch {
      return [];
    }
  }

  function handleInstitutionSelect(opt) {
    setSelectedInstitutionId(opt.value);
    setInstitutionLabel(opt.label);
    setSelectedProgramId("");
    setProgramLabel("");
    programService.list({ institutionId: opt.value }).catch(() => {});
  }

  async function onSubmit(values) {
    setSaving(true);
    try {
      // `password` belongs to the auth user, not the interns table. Strip it
      // (and any confirm field) so we never send a non-existent column to Supabase.
      const { password, confirmPassword, ...internValues } = values;
      // The auth/profile layer keeps a single `full_name`; the interns table
      // stores first_name / last_name separately.
      const fullName =
        [internValues.first_name, internValues.last_name]
          .filter(Boolean)
          .join(" ")
          .trim() || "An intern";
      const payload = {
        ...internValues,
        required_hours: Number(internValues.required_hours) || 0,
        // Coerce empty-string selects ("Unassigned") to null so we never send
        // "" into a uuid column (which throws and aborts the insert).
        department_id: internValues.department_id || null,
        supervisor_id: internValues.supervisor_id || null,
        institution_id: selectedInstitutionId || null,
        program_id: internValues.program_id || null,
        created_by: user?.id ?? profile?.id,
      };
      // Backend guard: ensure the chosen supervisor actually belongs to the
      // chosen department. Reject any invalid department-supervisor pairing
      // before we persist the intern (defense in depth beyond the UI filter).
      if (payload.supervisor_id && payload.department_id) {
        const assignedSup = supervisors.find(
          (s) => s.id === payload.supervisor_id,
        );
        if (
          !assignedSup ||
          assignedSup.department_id !== payload.department_id
        ) {
          throw new Error(
            "The selected supervisor does not belong to the selected department. Please choose a supervisor from the same department.",
          );
        }
      }

      if (editing) {
        await internService.update(editing.id, payload);
        // Full before/after diff across every editable intern field so the
        // audit log shows Previous Value / Updated Value for any change.
        await recordAudit({
          user_id: user?.id,
          action: "update",
          resource_type: "intern",
          resource_id: editing.id,
          changes: auditDiff(
            {
              first_name: editing.first_name ?? null,
              last_name: editing.last_name ?? null,
              contact_number: editing.contact_number ?? null,
              email: editing.email ?? null,
              emergency_contact: editing.emergency_contact ?? null,
              department_id: editing.department_id ?? null,
              supervisor_id: editing.supervisor_id ?? null,
              institution_id: editing.institution_id ?? null,
              program_id: editing.program_id ?? null,
              start_date: editing.start_date ?? null,
              end_date: editing.end_date ?? null,
              required_hours: editing.required_hours ?? null,
              status: editing.status ?? null,
            },
            {
              first_name: payload.first_name ?? null,
              last_name: payload.last_name ?? null,
              contact_number: payload.contact_number || null,
              email: payload.email || null,
              emergency_contact: payload.emergency_contact || null,
              department_id: payload.department_id,
              supervisor_id: payload.supervisor_id,
              institution_id: payload.institution_id,
              program_id: payload.program_id,
              start_date: payload.start_date || null,
              end_date: payload.end_date || null,
              required_hours: payload.required_hours,
              status: payload.status || null,
            },
          ),
        });

        // Notify if supervisor changed.
        if (
          payload.supervisor_id &&
          payload.supervisor_id !== editing.supervisor_id
        ) {
          const sup = supervisors.find((x) => x.id === payload.supervisor_id);
          if (sup?.profile_id) {
            await notify({
              user_id: sup.profile_id,
              type: "intern_assigned",
              title: "Intern reassigned",
              message: `${fullName} was reassigned to you.`,
              link: "/supervisor/interns",
            }).catch(() => {});
          }
        }

        toast.success("Intern updated.");
      } else {
        // Create a real auth user + linked intern record so the intern can log in.
        const newUser = await userService.createAuthUser({
          email: values.email,
          password: password,
          full_name: fullName,
          role: "intern",
        });

        const created = await internService.create({
          ...payload,
          profile_id: newUser.id,
        });
        await recordAudit({
          user_id: user?.id,
          action: "create",
          resource_type: "intern",
          resource_id: created?.id,
          changes: {
            first_name: payload.first_name,
            last_name: payload.last_name,
            supervisor_id: payload.supervisor_id,
          },
        });
        if (payload.supervisor_id) {
          const sup = supervisors.find((x) => x.id === payload.supervisor_id);
          if (sup?.profile_id)
            await notify({
              user_id: sup.profile_id,
              type: "intern_assigned",
              title: "New intern assigned",
              message: fullName + " was assigned to you.",
              link: "/supervisor/interns",
            });
        }
        if (newUser.id) {
          await notify({
            user_id: newUser.id,
            type: "account_created",
            title: "Your account is ready",
            message: "Your internship account was created. You can now log in.",
            link: "/intern",
          });
        }
        toast.success("Intern added.");
      }
      setModalOpen(false);
      load();
    } catch (err) {
      // L3: redacting logger - the raw Supabase error object can carry PII.
      logger.error("Intern create/update failed:", err);
      const message = String(err?.message || "");
      const lower = message.toLowerCase();
      // The most common real-world cause: the typed email is already registered
      // to an existing auth account (e.g. the admin's or a supervisor's email).
      // Turn that into a clear, actionable message instead of a raw error.
      if (
        lower.includes("already registered") ||
        lower.includes("already exists") ||
        lower.includes("duplicate")
      ) {
        toast.error(
          "This email is already registered to an existing account. Please use a different (unique) email for this intern.",
        );
      } else {
        const detail = err?.details || err?.hint || err?.code || "";
        toast.error(detail ? `${message} (${detail})` : message);
      }
    } finally {
      setSaving(false);
    }
  }

  async function confirmAction() {
    if (!confirm) return;
    setConfirming(true);
    try {
      if (confirm.type === "archive") {
        await internService.archive(confirm.row.id);
        // Notify the intern.
        if (confirm.row.profile_id) {
          await notify({
            user_id: confirm.row.profile_id,
            type: "intern_status",
            title: "Internship archived",
            message: "Your internship record has been archived.",
            link: "/intern",
          }).catch(() => {});
        }
        toast.success("Intern archived.");
      } else if (confirm.type === "restore") {
        await internService.restore(confirm.row.id);
        // Notify the intern.
        if (confirm.row.profile_id) {
          await notify({
            user_id: confirm.row.profile_id,
            type: "intern_status",
            title: "Internship restored",
            message: "Your internship record has been reactivated.",
            link: "/intern",
          }).catch(() => {});
        }
        toast.success("Intern restored.");
      } else {
        await internService.remove(confirm.row.id);
        await recordAudit({
          user_id: user?.id,
          action: "delete",
          resource_type: "intern",
          resource_id: confirm.row.id,
          // Snapshot of the values that existed before deletion.
          changes: auditDeleted({
            first_name: confirm.row.first_name,
            last_name: confirm.row.last_name,
            email: confirm.row.email,
            department_id: confirm.row.department_id,
            supervisor_id: confirm.row.supervisor_id,
          }),
        });
        toast.success("Intern deleted.");
      }
      setConfirm(null);
      load();
    } catch (err) {
      toast.error(err.message);
      setConfirm(null);
    } finally {
      setConfirming(false);
    }
  }

  const columns = [
    {
      key: "full_name",
      header: "Name",
      render: (r) => (
        <button
          onClick={() => setDetail(r)}
          className="text-left font-medium text-slate-800 hover:text-brand-700">
          {r.full_name}
        </button>
      ),
    },
    {
      key: "institution",
      header: "Institution",
      render: (r) => r.institution?.institution_name ?? "—",
    },
    {
      key: "program",
      header: "Program",
      render: (r) => r.program?.program_name ?? "—",
    },
    {
      key: "department",
      header: "Department",
      render: (r) => r.department?.name ?? "—",
    },
    {
      key: "supervisor",
      header: "Supervisor",
      render: (r) => r.supervisor?.full_name ?? "—",
    },
    {
      key: "required_hours",
      header: "Required Hrs",
      render: (r) => r.required_hours ?? "—",
    },
    {
      key: "start_date",
      header: "Start",
      render: (r) => formatDate(r.start_date),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge tone={STATUS_TONE[r.status] ?? "gray"}>
          {INTERN_STATUS_LABELS[r.status] ?? r.status}
        </Badge>
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
            onClick={() => openEdit(r)}
          />
          {r.status === "archived" ? (
            <ActionButton
              icon={RotateCcw}
              color="green"
              tooltip="Restore"
              onClick={() => setConfirm({ type: "restore", row: r })}
            />
          ) : (
            <ActionButton
              icon={Archive}
              color="amber"
              tooltip="Archive"
              onClick={() => setConfirm({ type: "archive", row: r })}
            />
          )}
          <ActionButton
            icon={Trash2}
            color="red"
            tooltip="Delete"
            onClick={() => setConfirm({ type: "delete", row: r })}
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
        title="Intern Management"
        description="Add, edit, assign and archive interns."
        action={<Button onClick={openCreate}>+ Add Intern</Button>}
      />

      <Card>
        <div className="grid gap-3 border-b border-brand-100 p-4 sm:grid-cols-3">
          <Input
            placeholder="Search name, institution…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <Select
            value={departmentId}
            onChange={(e) => {
              setDepartmentId(e.target.value);
              setPage(1);
            }}>
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}>
            <option value="">All Statuses</option>
            {Object.values(INTERN_STATUS).map((s) => (
              <option key={s} value={s}>
                {INTERN_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>

        {loading ? (
          <Spinner label="Loading interns…" />
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon="users"
              title="No interns found"
              description="Add your first intern or adjust the filters."
              action={<Button onClick={openCreate}>+ Add Intern</Button>}
            />
          </div>
        ) : (
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            empty={
              <div className="p-4 text-center text-sm text-slate-500">
                No records.
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

      {/* Add / Edit modal.
          `dismissible={false}` — this form is long (name, contact, emergency
          contact, institution, program, supervisor, dates, hours, password) and
          takes a while to fill in. Previously a stray click on the dimmed
          backdrop closed it and silently threw away all of that work. The X
          button and the Cancel action below remain the explicit ways out. */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        size="lg"
        dismissible={false}
        title={editing ? "Edit Intern" : "Add Intern"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit(onSubmit)} loading={saving}>
              {editing ? "Save Changes" : "Create Intern"}
            </Button>
          </>
        }>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="grid gap-4 sm:grid-cols-2">
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
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Contact number
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                  +63
                </span>
                <input
                  type="tel"
                  maxLength={10}
                  inputMode="numeric"
                  placeholder="9627070945"
                  className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-11 pr-3 text-sm text-slate-800 placeholder:text-slate-400 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  {...register("contact_number", {
                    pattern: {
                      value: /^[0-9]{0,10}$/,
                      message: "10 digits only (no leading 0)",
                    },
                  })}
                />
              </div>
              {errors.contact_number?.message && (
                <p className="mt-1 text-xs text-red-500">
                  {errors.contact_number.message}
                </p>
              )}
            </div>
            <Input
              label="Email"
              maxLength={100}
              type="email"
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
                  label="Temporary password"
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
                    required: !editing && "Password is required",
                    // H6: must match the server-side policy exactly (12+ chars,
                    // upper, lower, digit) or /api/admin/create-user rejects the
                    // request after the user has filled in the whole form.
                    minLength: { value: 12, message: "At least 12 characters" },
                    pattern: {
                      value: /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{12,}$/,
                      message: "Needs uppercase, lowercase and a number",
                    },
                  })}
                />
                {/* Live strength line: fills and changes color as the password
                    meets each requirement (8+ chars, upper, lower, number,
                    symbol). Replaces the old bulleted requirements list. */}
                <PasswordStrengthMeter password={watchedPassword} />
              </div>
            )}
            <Input
              label="Emergency contact"
              maxLength={15}
              error={errors.emergency_contact?.message}
              {...register("emergency_contact", {
                pattern: {
                  value: /^[0-9+\-\s]*$/,
                  message: "Numbers only",
                },
              })}
            />
            <SearchableSelect
              label="Institution"
              value={selectedInstitutionId}
              displayText={institutionLabel}
              onSearch={onInstitutionSearch}
              onSelect={handleInstitutionSelect}
              placeholder="Search institutions…"
            />
            <SearchableSelect
              label="Program"
              value={selectedProgramId}
              displayText={programLabel}
              disabled={!selectedInstitutionId}
              onSearch={onProgramSearch}
              onSelect={(opt) => {
                setSelectedProgramId(opt.value);
                setProgramLabel(opt.label);
                setValue("program_id", opt.value);
              }}
              placeholder={
                selectedInstitutionId
                  ? "Search programs…"
                  : "Select an institution first"
              }
            />
            <input type="hidden" {...register("program_id")} />
            <Select
              label="Department"
              {...register("department_id", {
                onChange: () => setValue("supervisor_id", ""),
              })}>
              <option value="">Unassigned</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <Select
              label="Supervisor"
              disabled={!selectedDepartmentId}
              {...register("supervisor_id")}>
              {!selectedDepartmentId ? (
                <option value="">Select a department first</option>
              ) : filteredSupervisors.length === 0 ? (
                <option value="">
                  No supervisors available for this department
                </option>
              ) : (
                <option value="">Unassigned</option>
              )}
              {filteredSupervisors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name || s.profile?.full_name || "Supervisor"}
                </option>
              ))}
            </Select>
            <Input
              label="Start date"
              type="date"
              error={errors.start_date?.message}
              {...register("start_date", {
                validate: (v) => {
                  if (!v) return true; // start date is optional
                  if (v > watchEndDate()) {
                    return "Start date cannot be after the end date";
                  }
                  return true;
                },
              })}
            />
            <Input
              label="End date"
              type="date"
              error={errors.end_date?.message}
              {...register("end_date", {
                validate: (v) => {
                  if (!v) return true; // open-ended internship is allowed
                  if (v < watchStartDate()) {
                    return "End date cannot be before the start date";
                  }
                  return true;
                },
              })}
            />
            <Input
              label="Required hours"
              type="number"
              min={1}
              error={errors.required_hours?.message}
              {...register("required_hours", {
                validate: (v) =>
                  v === "" || Number(v) >= 1 || "Required hours must be at least 1",
              })}
            />
            <Select label="Status" {...register("status")}>
              {Object.values(INTERN_STATUS).map((s) => (
                <option key={s} value={s}>
                  {INTERN_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
        </form>
      </Modal>

      {/* Detail modal */}
      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title="Intern Details"
        size="md">
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar name={detail.full_name} size="lg" />
              <div>
                <p className="text-lg font-semibold text-slate-800">
                  {detail.full_name}
                </p>
                <p className="text-sm text-slate-500">
                  {detail.institution?.institution_name ||
                    detail.program?.program_name ||
                    "—"}
                </p>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Detail label="First Name" value={detail.first_name} />
              <Detail label="Last Name" value={detail.last_name} />
              <Detail label="Email" maxLength={100} value={detail.email} />
              <Detail label="Contact" value={detail.contact_number} />
              <Detail label="Emergency" value={detail.emergency_contact} />
              <Detail label="Department" value={detail.department?.name} />
              <Detail label="Supervisor" value={detail.supervisor?.full_name} />
              <Detail label="Start" value={formatDate(detail.start_date)} />
              <Detail label="End" value={formatDate(detail.end_date)} />
              <Detail label="Required Hrs" value={detail.required_hours} />
              <Detail
                label="Status"
                value={INTERN_STATUS_LABELS[detail.status]}
              />
            </dl>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={confirmAction}
        title={
          confirm?.type === "delete"
            ? "Delete intern?"
            : confirm?.type === "archive"
              ? "Archive intern?"
              : "Restore intern?"
        }
        message={
          confirm?.type === "delete"
            ? `Permanently delete ${confirm?.row.full_name}? This removes the intern and ALL their attendance, journals, documents, and evaluations, and disables their login. This cannot be undone.`
            : confirm?.type === "archive"
              ? `${confirm?.row.full_name} will be moved to archived.`
              : `${confirm?.row.full_name} will be restored to active.`
        }
        confirmLabel={
          confirm?.type === "delete"
            ? "Delete"
            : confirm?.type === "archive"
              ? "Archive"
              : "Restore"
        }
        tone={confirm?.type === "delete" ? "danger" : "primary"}
        loading={confirming}
      />
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="rounded-lg bg-brand-50/50 px-3 py-2">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-700">{value ?? "—"}</dd>
    </div>
  );
}
