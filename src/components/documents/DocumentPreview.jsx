// src/components/documents/DocumentPreview.jsx
import { useEffect, useState } from "react";
import { getPreviewKind } from "@/services/documentService";
import { documentService } from "@/services/documentService";
import Button from "@/components/ui/Button";

/**
 * Renders a document inline where the browser is able to.
 *
 * Previously both the intern and admin document pages showed a hard-coded
 * "Document preview is not available in the browser." placeholder for every
 * file, regardless of type. PDFs and images are perfectly viewable inline via
 * the browser's native viewer, so this renders them properly and only falls
 * back to the message for formats (e.g. .doc/.docx) that genuinely cannot be
 * displayed without a server-side converter.
 */
export default function DocumentPreview({ doc, onDownload, downloading }) {
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const kind = getPreviewKind(doc);

  useEffect(() => {
    let cancelled = false;
    if (!doc || kind === "none") {
      setUrl(null);
      return undefined;
    }
    async function resolve() {
      setLoading(true);
      setError(null);
      try {
        // SECURITY: the bucket is private (migration 0045). Always mint a
        // fresh short-lived signed URL; a stored `file_url` is no longer a
        // valid access path and is ignored even if an old row still has one.
        if (!doc.file_path) {
          if (!cancelled) setError("This document has no stored file.");
          return;
        }
        const resolved = await documentService.downloadUrl(doc.file_path);
        if (!cancelled) setUrl(resolved);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    resolve();
    return () => {
      cancelled = true;
    };
  }, [doc, kind]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-500">
        Loading preview…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-dashed border-red-200 bg-red-50/50 p-6 text-center text-sm text-red-700">
        Could not load the file: {error}
      </div>
    );
  }

  if (kind === "none") {
    return (
      <div className="rounded-lg border border-dashed border-brand-200 bg-brand-50/50 p-6 text-center text-sm text-slate-500">
        <p className="font-medium text-slate-700">
          This file type cannot be displayed in the browser.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Word documents open in their own app. Download the file to view it.
        </p>
      </div>
    );
  }

  if (!url) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
        No file link is available for this document.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {kind === "image" ? (
        <img
          src={url}
          alt={doc.file_name || "Document preview"}
          className="max-h-[55vh] w-full rounded-lg border border-slate-200 bg-white object-contain"
        />
      ) : (
        <iframe
          src={url}
          title={doc.file_name || "Document preview"}
          className="h-[55vh] w-full rounded-lg border border-slate-200 bg-white"
        />
      )}

      {/* Some browsers block the inline viewer (or users simply want a new
          tab), so always offer an explicit escape hatch. */}
      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>
          Open in New Tab
        </Button>
        {onDownload && (
          <Button onClick={() => onDownload(doc)} loading={downloading}>
            Download
          </Button>
        )}
      </div>
    </div>
  );
}
