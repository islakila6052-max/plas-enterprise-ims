// src/pages/intern/InternDocuments.jsx
import { useEffect, useState, useCallback } from "react";
import { toast } from "react-hot-toast";
import { Eye, Download, Trash2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { Select } from "@/components/ui/Input";
import Card from "@/components/ui/Card";
import Table from "@/components/ui/Table";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";
import ErrorAlert from "@/components/ui/ErrorAlert";
import Modal from "@/components/ui/Modal";
import { documentService } from "@/services/documentService";
import { useAuth } from "@/contexts/AuthContext";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ActionButton from "@/components/ui/ActionButton";
import { DOCUMENT_STATUS_LABELS, DOCUMENT_TYPES } from "@/lib/constants";
import { formatDate } from "@/utils/format";
import { Icon } from "@/components/ui/icons";
import DocumentPreview from "@/components/documents/DocumentPreview";

const TONE = { pending: "amber", approved: "green", rejected: "red" };

// Maximum allowed upload size (5 MB).
const MAX_FILE_SIZE_MB = 5;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;
const TYPE_LABEL = Object.fromEntries(
  DOCUMENT_TYPES.map((t) => [t.value, t.label]),
);

// Maps each document type to a shared icon name.
function fileIcon(type) {
  const map = {
    resume: "fileText",
    moa: "fileText",
    endorsement: "fileText",
    school_requirements: "graduationCap",
    completion_report: "clipboardCheck",
  };
  return map[type] ?? "file";
}

export default function InternDocuments() {
  const { profile, internId } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [type, setType] = useState(DOCUMENT_TYPES[0].value);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    if (!internId) {
      setRows([]);
      setLoading(false);
      setLoadError(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const res = await documentService.list({
        internId,
        page: 1,
        pageSize: 50,
      });
      setRows(res.data ?? []);
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, [internId]);

  useEffect(() => {
    load();
  }, [load]);

  async function upload() {
    if (uploading) return;
    if (!internId) {
      toast.error("Your intern profile isn't linked yet. Please contact an administrator.");
      return;
    }
    if (!file) return toast.error("Choose a file first.");
    if (file.size > MAX_FILE_SIZE) {
      return toast.error(
        `File is too large. Maximum size is ${MAX_FILE_SIZE_MB} MB.`,
      );
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return toast.error("No internet connection. Please check your network and try again.");
    }
    // Prevent uploading the exact same file twice in a row (double-click guard).
    const existing = rows.some(
      (r) => r.file_name === file.name && r.type === type,
    );
    if (existing) {
      return toast.error("This file was already uploaded for this document type.");
    }
    setUploading(true);
    try {
      await documentService.upload({ internId, type, file });
      toast.success("Document uploaded.");
      setFile(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function download(row) {
    if (downloading) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("No internet connection. Please check your network and try again.");
      return;
    }
    setDownloading(true);
    try {
      // SECURITY: signed URL only - the storage bucket is private now.
      const url = await documentService.downloadUrl(row.file_path);
      if (!url) {
        toast.error("Download link unavailable.");
        return;
      }
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) {
        toast.error("Pop-up blocked. Please allow pop-ups to download this file.");
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDownloading(false);
    }
  }

  const [deleting, setDeleting] = useState(false);

  async function handleDelete(id, filePath) {
    setDeletingId(id);
    setDeleteDialog(true);
  }

  async function confirmedDelete(id, filePath) {
    if (!id) return;
    if (deleting) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("No internet connection. Please check your network and try again.");
      return;
    }
    setDeleting(true);
    try {
      await documentService.remove(id, filePath);
      toast.success("Document deleted.");
      // Optimistically drop it so a stale list can't resurrect it.
      setRows((prev) => prev.filter((r) => r.id !== id));
      setDeleteDialog(false);
      setDeletingId(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleting(false);
    }
  }

  const columns = [
    {
      key: "type",
      header: "Type",
      render: (r) => (
        <button
          onClick={() => setPreview(r)}
          className="flex items-center gap-2 text-left hover:text-brand-700">
          <Icon name={fileIcon(r.type)} className="h-5 w-5 text-brand-600" />
          <span>{TYPE_LABEL[r.type] ?? r.type}</span>
        </button>
      ),
    },
    {
      key: "created",
      header: "Uploaded",
      render: (r) => formatDate(r.created_at),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge tone={TONE[r.status] ?? "gray"}>
          {DOCUMENT_STATUS_LABELS[r.status] ?? r.status}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <div className="flex items-center justify-center gap-1">
          <ActionButton
            icon={Eye}
            color="green"
            tooltip="Preview"
            onClick={() => setPreview(r)}
          />
          <ActionButton
            icon={Download}
            color="indigo"
            tooltip="Download"
            onClick={() => download(r)}
            loading={downloading}
          />
          {r.status === "pending" && (
            <ActionButton
              icon={Trash2}
              color="red"
              tooltip="Delete"
              onClick={() => handleDelete(r.id, r.file_path)}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documents"
        description="Upload and track your required documents."
      />

      <Card>
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
          <Select
            label="Document type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="sm:max-w-xs">
            {DOCUMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <input
            type="file"
            onChange={(e) => {
              const selected = e.target.files?.[0] ?? null;
              if (selected && selected.size > MAX_FILE_SIZE) {
                toast.error(
                  `"${selected.name}" exceeds the ${MAX_FILE_SIZE_MB} MB limit.`,
                );
                e.target.value = ""; // reset so the same file can be re-picked
                setFile(null);
                return;
              }
              setFile(selected);
            }}
            className="block w-full text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
            accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
          />
          <Button onClick={upload} loading={uploading}>
            Upload
          </Button>
          <p className="text-xs text-slate-400 sm:max-w-xs">
            Maximum file size: {MAX_FILE_SIZE_MB} MB.
          </p>
        </div>
      </Card>

      <Card>
        <div className="border-b border-brand-100 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-800">
            My Documents
          </h3>
        </div>
        {loading ? (
          <Spinner label="Loading documents…" />
        ) : loadError ? (
          <div className="p-5">
            <ErrorAlert message={loadError.message} onRetry={load} loading={loading} />
          </div>
        ) : (
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            empty={
              <div className="p-4 text-center text-sm text-slate-500">
                No documents uploaded yet.
              </div>
            }
          />
        )}
      </Card>

      <ConfirmDialog
        open={deleteDialog}
        onClose={() => !deleting && setDeleteDialog(false)}
        onConfirm={() => confirmedDelete(deletingId)}
        title="Delete Document"
        message="Are you sure you want to delete this document? This action cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        loading={deleting}
      />

      <Modal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title="Document Preview"
        size="md">
        {preview && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-3">
              <Icon
                name={fileIcon(preview.type)}
                className="h-10 w-10 text-brand-600"
              />
              <div>
                <p className="font-medium text-slate-800">
                  {preview.file_name ?? TYPE_LABEL[preview.type]}
                </p>
                <Badge tone={TONE[preview.status] ?? "gray"}>
                  {DOCUMENT_STATUS_LABELS[preview.status]}
                </Badge>
              </div>
            </div>
            <DocumentPreview
              doc={preview}
              onDownload={download}
              downloading={downloading}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
