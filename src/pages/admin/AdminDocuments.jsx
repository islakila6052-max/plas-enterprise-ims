// src/pages/admin/AdminDocuments.jsx
import { useEffect, useState, useCallback } from "react";
import { toast } from "react-hot-toast";
import { Eye, Download, CheckCircle, XCircle, Trash2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Table from "@/components/ui/Table";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";
import Pagination from "@/components/ui/Pagination";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import ErrorAlert from "@/components/ui/ErrorAlert";
import { documentService } from "@/services/documentService";

import {
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_TYPES,
  PAGE_SIZE,
} from "@/lib/constants";
import { formatDate } from "@/utils/format";
import { recordAudit } from "@/services/activityService";
import { useAuth } from "@/contexts/AuthContext";
import { Icon } from "@/components/ui/icons";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ActionButton from "@/components/ui/ActionButton";
import DocumentPreview from "@/components/documents/DocumentPreview";

const TONE = { pending: "amber", approved: "green", rejected: "red" };
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

export default function AdminDocuments() {
  const { user } = useAuth();

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await documentService.list({ page });
      setRows(res.data);
      setTotal(res.count);
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  async function review(row, status) {
    if (reviewing) return; // block double-clicks
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("No internet connection. Please check your network and try again.");
      return;
    }
    setReviewing(true);
    try {
      // documentService.review() already sends a notification to the intern.
      await documentService.review(row.id, status);
      await recordAudit({
        user_id: user?.id,
        action: "review",
        resource_type: "document",
        resource_id: row.id,
        changes: { status },
      });
      toast.success(`Document ${status}.`);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setReviewing(false);
    }
  }

  async function download(row) {
    setDownloading(true);
    try {
      // SECURITY: the bucket is private, so a signed URL is the only way in.
      // Never prefer `row.file_url` - migration 0045 nulls it out precisely so
      // a stale public link can never be rendered again.
      const url = await documentService.downloadUrl(row.file_path);
      if (!url) {
        toast.error("Download link unavailable.");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDownloading(false);
    }
  }

  async function handleDelete(id, filePath) {
    setDeletingId({ id, filePath });
    setDeleteDialog(true);
  }

  async function confirmedDelete() {
    if (!deletingId?.id) return;
    if (deleting) return; // block double-clicks
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("No internet connection. Please check your network and try again.");
      setDeleteDialog(false);
      setDeletingId(null);
      return;
    }
    setDeleting(true);
    try {
      await documentService.remove(deletingId.id, deletingId.filePath);
      toast.success("Document deleted.");
      setDeleteDialog(false);
      setDeletingId(null);
      load();
    } catch (err) {
      toast.error(err.message);
      setDeleteDialog(false);
      setDeletingId(null);
    } finally {
      setDeleting(false);
    }
  }

  const columns = [
    {
      key: "intern",
      header: "Intern",
      render: (r) => (
        <div>
          <p className="font-medium text-slate-800">{r.intern?.full_name}</p>
          <p className="text-xs text-slate-400">{r.intern?.last_name}</p>
        </div>
      ),
    },
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
      header: "Actions",
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
            <>
              <ActionButton
                icon={CheckCircle}
                color="green"
                tooltip="Approve"
                onClick={() => review(r, "approved")}
                loading={reviewing}
              />
              <ActionButton
                icon={XCircle}
                color="red"
                tooltip="Reject"
                onClick={() => review(r, "rejected")}
                loading={reviewing}
              />
              {r.intern_id && (
                <ActionButton
                  icon={Trash2}
                  color="red"
                  tooltip="Delete"
                  onClick={() => handleDelete(r.id, r.file_path)}
                />
              )}
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Documents"
        description="Review and approve intern documents."
      />
      <Card>
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
                No documents uploaded.
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
                <p className="text-slate-500">{preview.intern?.full_name}</p>
              </div>
            </div>
            <DocumentPreview
              doc={preview}
              onDownload={download}
              downloading={downloading}
            />
            {preview.status === "pending" && (
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <Button
                  onClick={() => {
                    review(preview, "approved");
                    setPreview(null);
                  }}
                  loading={reviewing}>
                  Approve
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    review(preview, "rejected");
                    setPreview(null);
                  }}
                  loading={reviewing}>
                  Reject
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={deleteDialog}
        onClose={() => !deleting && setDeleteDialog(false)}
        onConfirm={confirmedDelete}
        title="Delete Document"
        message="Are you sure you want to delete this document? This action cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        loading={deleting}
      />
    </div>
  );
}
