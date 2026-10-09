// src/pages/supervisor/SupervisorDocuments.jsx
// Read-only view of documents submitted by the supervisor's own interns.
//
// Why this page exists: the "New document submitted" notification links to
// /supervisor/documents, but that route never existed — the click fell through
// to the catch-all route which redirects to /login, so it looked like the user
// was logged out. This page is the real destination.
//
// Supervisors can preview and download; approve/reject/delete remain admin-only
// (documentService.review goes through an admin-only RPC, and the RLS DELETE
// policy is limited to the owning intern and admins).
import { useEffect, useState, useCallback } from "react";
import { toast } from "react-hot-toast";
import { Eye, Download } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Table from "@/components/ui/Table";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";
import Pagination from "@/components/ui/Pagination";
import Modal from "@/components/ui/Modal";
import ErrorAlert from "@/components/ui/ErrorAlert";
import ActionButton from "@/components/ui/ActionButton";
import DocumentPreview from "@/components/documents/DocumentPreview";
import { documentService } from "@/services/documentService";
import { useAuth } from "@/contexts/AuthContext";
import {
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_TYPES,
  PAGE_SIZE,
} from "@/lib/constants";
import { formatDate } from "@/utils/format";
import { Icon } from "@/components/ui/icons";

const TONE = { pending: "amber", approved: "green", rejected: "red" };
const TYPE_LABEL = Object.fromEntries(
  DOCUMENT_TYPES.map((t) => [t.value, t.label]),
);

// Maps each document type to a shared icon name (same as AdminDocuments).
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

export default function SupervisorDocuments() {
  const { supervisorId } = useAuth();

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    if (!supervisorId) {
      setRows([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      // RLS scopes this to the supervisor's own interns; the explicit filter
      // keeps the intent clear and matches the list service's INNER-join form.
      const res = await documentService.list({
        supervisorId,
        page,
      });
      setRows(res.data);
      setTotal(res.count);
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, [supervisorId, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function download(row) {
    setDownloading(true);
    try {
      // The bucket is private: a signed URL is the only way in. Never use
      // row.file_url (nulled out by migration 0045 precisely for this reason).
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
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Documents"
        description="Documents submitted by your interns for review."
      />
      <Card>
        {loading ? (
          <Spinner label="Loading documents…" />
        ) : loadError ? (
          <div className="p-5">
            <ErrorAlert
              message={loadError.message}
              onRetry={load}
              loading={loading}
            />
          </div>
        ) : (
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            empty={
              <div className="p-4 text-center text-sm text-slate-500">
                No documents submitted yet.
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
          </div>
        )}
      </Modal>
    </div>
  );
}
