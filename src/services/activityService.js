import { supabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";

/**
 * Central place to record admin/supervisor/intern actions (audit_logs) and
 * push per-user notifications. Both are best-effort: a failure here should
 * never break the primary CRUD operation.
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

/** Notify a specific user. */
export async function notify(payload) {
  if (!payload?.user_id) return;
  try {
    // Fix: notifications must be written through the `notify_user` SECURITY
    // DEFINER RPC. A direct INSERT into `notifications` is denied by RLS - the
    // table only grants SELECT + UPDATE to `authenticated` (migration 0046) -
    // which surfaces in the browser as:
    //   POST /rest/v1/notifications 403 (Forbidden)
    const { error } = await supabase.rpc("notify_user", {
      p_user_id: payload.user_id,
      p_type: payload.type,
      p_title: payload.title,
      p_message: payload.message,
      p_link: payload.link ?? null,
      p_metadata: payload.metadata ?? {},
    });
    if (error)
      logger.error("[NOTIFICATION] Failed to create notification:", error);
  } catch (err) {
    logger.error("[NOTIFICATION] Unexpected error:", err);
  }
}

/**
 * Fetch all profile ids for a role.
 *
 * SECURITY (C4): since migration 0045 scoped `profiles` SELECT (an intern can no
 * longer list every admin's row), this goes through the `profile_ids_by_role`
 * SECURITY DEFINER RPC. It returns ONLY the uuid column, so no email /
 * contact_number / bio is ever exposed to the caller.
 */
async function getProfileIdsByRole(role) {
  const { data } = await supabase.rpc("profile_ids_by_role", {
    p_role: role,
  });
  return data ?? [];
}

async function getInternProfile(internId) {
  if (!internId) return null;
  // `internId` here is an interns.id, not a profiles.id - resolve it properly
  // so notification fan-out actually reaches the intended intern.
  const { data } = await supabase.rpc("intern_profile_id", {
    p_intern_row_id: internId,
  });
  return data ? { id: data } : null;
}

/**
 * Core fan-out: builds and inserts notifications for admins, supervisors,
 * and (optionally) one intern, in a single batch insert.
 *
 * `resolve(role)` lets callers customize type/title/message/link per role
 * (admin | supervisor | intern), falling back to the shared defaults.
 */
async function fanOutNotifications({ internId, metadata, resolve }) {
  try {
    const [adminProfiles, supervisorProfiles, internProfile] =
      await Promise.all([
        getProfileIdsByRole("admin"),
        getProfileIdsByRole("supervisor"),
        getInternProfile(internId),
      ]);

    const notifications = [];

    for (const admin of adminProfiles) {
      const r = resolve("admin");
      if (r)
        notifications.push({
          user_id: admin.id,
          metadata: metadata ?? {},
          ...r,
        });
    }
    for (const supervisor of supervisorProfiles) {
      const r = resolve("supervisor");
      if (r)
        notifications.push({
          user_id: supervisor.id,
          metadata: metadata ?? {},
          ...r,
        });
    }
    if (internProfile?.id) {
      const r = resolve("intern");
      if (r)
        notifications.push({
          user_id: internProfile.id,
          metadata: metadata ?? {},
          ...r,
        });
    }

    if (notifications.length > 0) {
      // Fix: route each notification through the `notify_user` SECURITY DEFINER
      // RPC. A direct batch INSERT into `notifications` is denied by RLS
      // (`authenticated` only has SELECT + UPDATE), i.e. the
      // `POST /rest/v1/notifications 403 (Forbidden)` error.
      const results = await Promise.all(
        notifications.map((n) =>
          supabase.rpc("notify_user", {
            p_user_id: n.user_id,
            p_type: n.type,
            p_title: n.title,
            p_message: n.message,
            p_link: n.link ?? null,
            p_metadata: n.metadata ?? {},
          }),
        ),
      );
      const failed = results.find((r) => r.error);
      if (failed)
        logger.error(
          "[NOTIFICATION FANOUT] Failed to create notifications:",
          failed.error,
        );
    }
  } catch (err) {
    logger.error("[NOTIFICATION FANOUT] Unexpected error:", err);
  }
}

/** Notify all admins + supervisors + (optional) one intern with the same content. */
export async function notifyAll(payload) {
  return fanOutNotifications({
    internId: payload.internId,
    metadata: payload.metadata,
    resolve: () => ({
      type: payload.type,
      title: payload.title,
      message: payload.message,
      link: payload.link ?? null,
    }),
  });
}

/** Alias kept for backwards compatibility with existing callers. */
export async function notifyAllWithType(payload) {
  return notifyAll(payload);
}

/**
 * Notify all three subjects, but allow per-role overrides
 * (adminType/adminTitle/adminMessage/adminLink, supervisorX, internX).
 * Falls back to the shared `type`/`title`/`message`/`link` when a role-specific
 * field isn't provided.
 */
export async function notifyAllForAction(payload) {
  return fanOutNotifications({
    internId: payload.internId,
    metadata: payload.metadata,
    resolve: (role) => ({
      type: payload[`${role}Type`] || payload.type,
      title: payload[`${role}Title`] || payload.title,
      message: payload[`${role}Message`] || payload.message,
      link: payload[`${role}Link`] || payload.link || null,
    }),
  });
}

/** Same as notifyAllForAction, but with safe string defaults if nothing is set. */
export async function notifyAllForActionWithTypes(payload) {
  return fanOutNotifications({
    internId: payload.internId,
    metadata: payload.metadata,
    resolve: (role) => ({
      type: payload[`${role}Type`] || payload.type || "announcement",
      title: payload[`${role}Title`] || payload.title || "Notification",
      message:
        payload[`${role}Message`] ||
        payload.message ||
        "You have a new notification.",
      link: payload[`${role}Link`] || payload.link || null,
    }),
  });
}
