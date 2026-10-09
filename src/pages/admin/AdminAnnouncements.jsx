// src/pages/admin/AdminAnnouncements.jsx
import { useEffect, useState, useCallback } from "react";
import { toast } from "react-hot-toast";
import { useForm } from "react-hook-form";
import { Pin, PinOff, Pencil, Trash2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import Modal from "@/components/ui/Modal";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ErrorAlert from "@/components/ui/ErrorAlert";
import EmptyState from "@/components/ui/EmptyState";
import LikersPopover from "@/components/announcements/LikersPopover";
import { announcementService } from "@/services/announcementService";
import { useAuth } from "@/contexts/AuthContext";
import { ANNOUNCEMENT_CATEGORIES } from "@/lib/constants";
import { formatDate, formatTime } from "@/utils/format";
import { notifyAllWithType } from "@/services/activityService";
import ActionButton from "@/components/ui/ActionButton";

export default function AdminAnnouncements() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [pinning, setPinning] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    defaultValues: { title: "", body: "", category: "company_news" },
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await announcementService.list({});
      setRows(res.data);
    } catch (err) {
      setLoadError(err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    reset({ title: "", body: "", category: "company_news" });
    setModalOpen(true);
  }

  function openEdit(a) {
    setEditing(a);
    reset({ title: a.title, body: a.body, category: a.category });
    setModalOpen(true);
  }

  async function onSubmit(values) {
    if (saving) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("No internet connection. Please check your network and try again.");
      return;
    }
    const title = String(values.title ?? "").trim();
    const body = String(values.body ?? "").trim();
    if (!title || !body) {
      toast.error("Title and message are required.");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await announcementService.update(editing.id, { ...values, title, body });
        toast.success("Announcement updated.");
      } else {
        await announcementService.create({ ...values, title, body, published_by: user?.id });

        // Notify all users about the new announcement.
        notifyAllWithType({
          type: "announcement",
          title: `New announcement: ${title}`,
          message:
            body.substring(0, 120) +
            (body.length > 120 ? "…" : ""),
          link: "/intern/announcements",
          metadata: { category: values.category },
        }).catch(() => {});

        toast.success("Announcement published.");
      }
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function togglePin(a) {
    if (pinning) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("No internet connection. Please check your network and try again.");
      return;
    }
    setPinning(true);
    try {
      await announcementService.update(a.id, { pinned: !a.pinned });
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPinning(false);
    }
  }

  async function remove() {
    if (deleting) return;
    if (!confirm?.id) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("No internet connection. Please check your network and try again.");
      return;
    }
    setDeleting(true);
    try {
      await announcementService.remove(confirm.id);
      toast.success("Deleted.");
      setConfirm(null);
      load();
    } catch (err) {
      toast.error(err.message);
      setConfirm(null);
    } finally {
      setDeleting(false);
    }
  }

  const catLabel = Object.fromEntries(
    ANNOUNCEMENT_CATEGORIES.map((c) => [c.value, c.label]),
  );

  return (
    <div>
      <PageHeader
        title="Announcements"
        description="Publish company news, deadlines and reminders."
        action={<Button onClick={openCreate}>+ New Announcement</Button>}
      />

      {loading ? (
        <Spinner label="Loading announcements…" />
      ) : loadError ? (
        <ErrorAlert message={loadError.message} onRetry={load} loading={loading} />
      ) : (
        <div className="space-y-4">
          {rows.map((a) => (
            <Card key={a.id}>
              <div className="p-5">
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-medium">
                    {/* Pinned state leads the meta row so the status reads
                        first, at the top-left of the announcement, instead of
                        trailing below the message body. */}
                    {a.pinned && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                        <Pin className="h-3 w-3" /> Pinned
                      </span>
                    )}
                    <span className="text-brand-600">
                      {catLabel[a.category] ?? a.category}
                    </span>
                    <span className="text-slate-300">·</span>
                    <span className="text-slate-400">
                      {formatTime(a.created_at)}
                    </span>
                  </div>
                  <h3 className="break-words text-lg font-semibold text-slate-800">
                    {a.title}
                  </h3>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">
                    {a.body}
                  </p>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-slate-400">
                      {formatDate(a.created_at)}
                    </p>
                    <LikersPopover
                      announcementId={a.id}
                      count={a.like_count ?? 0}
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <ActionButton
                      icon={a.pinned ? PinOff : Pin}
                      color="amber"
                      tooltip={a.pinned ? "Unpin" : "Pin"}
                      onClick={() => togglePin(a)}
                      loading={pinning}
                    />
                    <ActionButton
                      icon={Pencil}
                      color="blue"
                      tooltip="Edit"
                      onClick={() => openEdit(a)}
                    />
                    <ActionButton
                      icon={Trash2}
                      color="red"
                      tooltip="Delete"
                      onClick={() => setConfirm(a)}
                    />
                  </div>
                </div>
              </div>
            </Card>
          ))}
          {rows.length === 0 && (
            <EmptyState
              title="No announcements yet"
              description="Publish your first update so interns see it on their Announcements page."
              action={
                <Button onClick={openCreate}>+ New Announcement</Button>
              }
            />
          )}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={editing ? "Edit Announcement" : "New Announcement"}
        footer={
          <>
            <Button variant="secondary" onClick={() => !saving && setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSubmit(onSubmit)} loading={saving}>
              {editing ? "Save" : "Publish"}
            </Button>
          </>
        }>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <Input
            label="Title"
            maxLength={120}
            error={errors.title?.message}
            {...register("title", {
              required: "Title is required",
              validate: (v) => (v ?? "").trim().length > 0 || "Title is required",
            })}
          />
          <Select label="Category" {...register("category")}>
            {ANNOUNCEMENT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
          <Textarea
            label="Message"
            rows={5}
            maxLength={2000}
            error={errors.body?.message}
            {...register("body", {
              required: "Message is required",
              validate: (v) => (v ?? "").trim().length > 0 || "Message is required",
            })}
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => !deleting && setConfirm(null)}
        onConfirm={remove}
        title="Delete announcement?"
        message={`Delete "${confirm?.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
        loading={deleting}
      />
    </div>
  );
}
