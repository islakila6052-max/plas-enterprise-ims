// src/services/documentService.js
import { supabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { notify } from "@/services/activityService";

const BUCKET = "intern-documents";

/**
 * Best-effort MIME type from a filename, for when the browser reports an empty
 * `file.type` (common for Office documents on some OSes).
 */
function guessMimeType(name) {
  if (!name) return null;
  const ext = String(name).split(".").pop()?.toLowerCase();
  const map = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return map[ext] ?? null;
}

/**
 * Classify a document for inline preview.
 * Prefers the stored `mime_type`; falls back to the file extension so older
 * rows uploaded before `mime_type` was persisted still preview correctly.
 */
export function getPreviewKind(doc) {
  if (!doc) return "none";
  const mime = (doc.mime_type || "").toLowerCase();
  const ext = (doc.file_name || doc.label || "").split(".").pop()?.toLowerCase();

  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp"].includes(ext))
    return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  return "none";
}


/**
 * Safely execute a Supabase query, returning null on network failure.
 * Used for non-critical queries that should not crash the UI.
 */
async function safeQuery(fn) {
  try {
    return await fn();
  } catch (err) {
    logger.error("[IMS] Safe query failed:", err.message);
    return null;
  }
}

/**
 * SECURITY (C3): build a safe object name for the private bucket.
 *
 * The previous name was `${Date.now()}-${file.name}`, which embedded the
 * user-supplied filename verbatim into the storage path. That leaked the
 * intern's real name through the URL and allowed path/control characters to
 * ride along. We keep only a conservative extension and randomise the stem, so
 * nothing about the user is disclosed and no path segment is client-crafted.
 *
 * The RLS policy (migration 0045) already requires the first folder segment to
 * equal the caller's own intern id; this keeps the second segment inert too.
 */
function buildStorageName(file) {
  const raw = String(file?.name ?? "");
  const dot = raw.lastIndexOf(".");
  const ext = dot > -1 ? raw.slice(dot + 1).toLowerCase() : "";
  const safeExt = /^[a-z0-9]{1,8}$/.test(ext) ? ext : "bin";
  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${rand}.${safeExt}`;
}

export const documentService = {
  async list({ internId, status, supervisorId, page = 1, pageSize = 15 } = {}) {
    // Supervisors scope to their own interns. This needs an INNER join on
    // `interns` so PostgREST can filter parent rows by the embedded
    // `intern.supervisor_id` — a LEFT join cannot be filtered and would
    // silently return every document in the system.
    const internEmbed = supervisorId
      ? "intern:interns!inner(first_name, last_name, full_name, profile_id)"
      : "intern:interns(first_name, last_name, full_name, profile_id)";
    let query = supabase
      .from("documents")
      .select(`*, ${internEmbed}`, {
        count: "exact",
      })
      .order("created_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (internId) query = query.eq("intern_id", internId);
    if (supervisorId) query = query.eq("intern.supervisor_id", supervisorId);
    if (status) query = query.eq("status", status);
    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    return { data: data ?? [], count: count ?? 0 };
  },

  async upload({ internId, type, file, label }) {
    const path = `${internId}/${buildStorageName(file)}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { upsert: false });
    if (upErr) throw new Error(upErr.message);
    // SECURITY (C3): the `intern-documents` bucket is PRIVATE (migration 0045).
    // We must never persist a public URL here - `documents.file_url` used to
    // hold getPublicUrl() output, which handed out a permanent, unauthenticated
    // link to the intern's resume / MOA / endorsement. `file_url` is now always
    // null and every read resolves a short-lived signed URL instead.
    const { data, error } = await supabase
      .from("documents")
      .insert({
        intern_id: internId,
        type,
        label: label || type,
        file_path: path,
        file_url: null,
        file_name: file?.name ?? `${type}.pdf`,
        // Persist the MIME type and byte size. Without these the UI had no way
        // to know whether a document could be rendered inline, so every preview
        // fell back to a "cannot preview" placeholder. `file.type` can be empty
        // for some browsers/OSes, so fall back to a name-based guess.
        mime_type: file?.type || guessMimeType(file?.name),
        file_size: file?.size ?? null,
        status: "pending",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    // Notify supervisor + admin about new document
    try {
      const { data: intern } = await supabase
        .from("interns")
        .select("full_name, supervisor_id")
        .eq("id", internId)
        .single();

      if (intern?.supervisor_id) {
        // C4: `intern.supervisor_id` is a supervisors.id, not a profiles.id.
        // Resolving it with a SECURITY DEFINER helper returns the auth user id
        // without needing broad read access to the profiles table.
        const { data: supProfileId } = await supabase.rpc(
          "supervisor_profile_id",
          { p_supervisor_row_id: intern.supervisor_id },
        );
        if (supProfileId) {
          await notify({
            user_id: supProfileId,
            type: "document_review",
            title: "New document submitted",
            message: `${intern.full_name || "An intern"} submitted a document for review.`,
            link: "/supervisor/documents",
            metadata: { intern_id: internId, document_id: data.id },
          });
        }
      }

      // C4: notify admins. profile_ids_by_role() returns ONLY the uuid column, so
      // this no longer requires reading every admin's profile row.
      const { data: adminIds } = await supabase.rpc("profile_ids_by_role", {
        p_role: "admin",
      });

      for (const adminId of adminIds || []) {
        await notify({
          user_id: adminId,
          type: "document_review",
          title: "New document submitted",
          message: `${intern?.full_name || "An intern"} submitted a document for review.`,
          link: "/admin/documents",
          metadata: { intern_id: internId, document_id: data.id },
        });
      }
    } catch (err) {
      logger.error("[DOCUMENT NOTIFICATION] Failed:", err);
    }

    return data;
  },

  async review(id, status) {
    // H2: document status is a reviewer decision, so it is set by the
    // `document_review` RPC (admin-only) rather than by a client UPDATE that an
    // intern could have used to mark their own upload 'approved'.
    const { data, error } = await supabase.rpc("document_review", {
      p_document_id: id,
      p_status: status,
    });
    if (error) throw new Error(error.message);

    // Notify intern about review
    try {
      const { data: document } = await supabase
        .from("documents")
        .select("*, intern:interns(full_name, profile_id)")
        .eq("id", id)
        .single();

      if (document?.intern?.profile_id) {
        await notify({
          user_id: document.intern.profile_id,
          type: "document_review",
          title: `Document ${status}`,
          message: `Your document "${document.file_name ?? document.label}" was ${status}.`,
          link: "/intern/documents",
          metadata: { document_id: id, status },
        });
      }
    } catch (err) {
      logger.error("[DOCUMENT REVIEW NOTIFICATION] Failed:", err);
    }

    return data;
  },

  /**
   * Resolve a short-lived signed URL for a stored document.
   *
   * C3: the bucket is private (migration 0045), so this is the ONLY supported
   * way to read a file. Never fall back to a stored `file_url` - that column is
   * now always null and is retained only so old rows keep their shape.
   */
  async downloadUrl(filePath) {
    if (!filePath) throw new Error("This document has no stored file.");
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(filePath, 60);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },

  /**
   * Convenience wrapper used by the UI: always returns a fresh signed URL.
   * Accepts either a full document row or a bare storage path.
   */
  async resolveUrl(doc) {
    const path = typeof doc === "string" ? doc : doc?.file_path;
    return this.downloadUrl(path);
  },

  async remove(id, filePath) {
    if (filePath) await supabase.storage.from(BUCKET).remove([filePath]);
    const { error } = await supabase.from("documents").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return;
  },

  /**
   * Fetch document count with graceful degradation.
   * Returns safe defaults on network failure.
   */
  async getStats(internId) {
    if (!internId) return { totalDocuments: 0 };

    const result = await safeQuery(() =>
      supabase.from("documents").select("*", { count: "exact", head: true }).eq("intern_id", internId)
    );

    return { totalDocuments: result?.count ?? 0 };
  },
};
