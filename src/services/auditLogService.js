// src/services/auditLogService.js
import { supabase } from "@/lib/supabase";

/**
 * Audit log service. Append-only activity trail keyed by user, resource type
 * and resource id. Data is written to the Supabase `audit_logs` table.
 *
 * Table columns (see DATABASE_SCHEMA.md):
 *   id, user_id, action, resource_type, resource_id, changes, ip_address,
 *   user_agent, created_at
 */

export const auditLogService = {
  /** List audit logs, optionally filtered by resource. Newest first. */
  async list({ resourceType = "", resourceId = "", limit = 100 } = {}) {
    let query = supabase
      .from("audit_logs")
      // Embed the acting user's profile so the admin view can show WHO made
      // each change instead of a raw UUID. Falls back gracefully when the
      // user row was hard-deleted (user_id becomes null via ON DELETE SET NULL).
      .select("*, user:user_id (full_name, email)")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (resourceType) query = query.eq("resource_type", resourceType);
    if (resourceId) query = query.eq("resource_id", resourceId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data ?? [];
  },

  /** Create an audit log entry (system/admin flows). */
  async create(payload) {
    const { data, error } = await supabase
      .from("audit_logs")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
};
