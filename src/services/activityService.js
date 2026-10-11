import { supabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";

/**
 * Record admin/supervisor/intern actions (audit_logs). A failure here should
 * never break the primary CRUD operation. Database events create notifications.
 */

/**
 * Build a field-level diff between the previous and next state of a record.
 * Only fields that actually changed are included. Every entry is stored as
 * an explicit { from, to } pair so both the previous value and the updated
 * value remain available in the audit log even after the original record is
 * modified or deleted.
 *
 *   auditDiff({ name: "A" }, { name: "B", role: "x" })
 *   // => { name: { from: "A", to: "B" }, role: { from: null, to: "x" } }
 */
export function auditDiff(previous = {}, next = {}) {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  const changes = {};
  for (const key of keys) {
    const from = previous[key] ?? null;
    const to = next[key] ?? null;
    if (String(from) !== String(to)) changes[key] = { from, to };
  }
  return changes;
}

/**
 * Snapshot of values for CREATE actions — no previous value exists, so every
 * entry records `from: null` plus the created value.
 */
export function auditCreated(values = {}) {
  const changes = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) changes[key] = { from: null, to: value ?? null };
  }
  return changes;
}

/**
 * Snapshot of values for DELETE actions — captures what existed immediately
 * before deletion as `from`, with no updated value (`to: null`).
 */
export function auditDeleted(values = {}) {
  const changes = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) changes[key] = { from: value ?? null, to: null };
  }
  return changes;
}

/**
 * Normalize any legacy changes shape into { from, to } pairs so old flat
 * entries ({ field: value }) still render correctly.
 */
function normalizeChanges(changes) {
  if (!changes || typeof changes !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(changes)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !(value instanceof Date) &&
      ("from" in value || "to" in value)
    ) {
      out[key] = { from: value.from ?? null, to: value.to ?? null };
    } else {
      out[key] = { from: null, to: value ?? null };
    }
  }
  return out;
}

export async function recordAudit(entry) {
  try {
    // M3: route through the `write_audit_log` RPC. It resolves the acting user
    // from the JWT and captures ip_address / user_agent server-side from the
    // request headers, which the client cannot forge. Previously this insert
    // supplied both columns as null, so the audit trail could never attribute
    // an action to a device or network.
    const { error } = await supabase.rpc("write_audit_log", {
      p_action: entry.action, // create | update | delete | review | login
      p_resource_type: entry.resource_type,
      p_resource_id: entry.resource_id ?? null,
      p_changes: normalizeChanges(entry.changes),
    });
    if (error) throw error;
  } catch (err) {
    // Non-fatal: never block the primary action. Surfaced in dev so a
    // misconfigured database is not mistaken for "auditing is working".
    if (import.meta.env?.DEV) {
      logger.error("[AUDIT] Failed to record audit entry:", err);
    }
  }
}
