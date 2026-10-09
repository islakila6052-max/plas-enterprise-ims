// src/services/dashboardService.js
import { supabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { todayDateInAttendanceTZ } from "@/utils/format";

/**
 * Aggregated counts or dashboards. Each function degrades gracefully to zeros
 * when a table is empty. All data is sourced from Supabase.
 */

async function count(table, query) {
  let q = supabase.from(table).select("*", { count: "exact", head: true });
  if (query) q = query(q);
  const { count, error } = await q;
  if (error) {
    // A single failing count (e.g. an unauthenticated request, or a filter
    // the gateway rejects) must never break the whole dashboard. Degrade to 0.
    logger.error(`[IMS] count(${table}) failed:`, error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * Safely execute a Supabase query, returning null on network failure
 * instead of throwing. Used by dashboard stats that must never crash.
 */
async function safeQuery(fn) {
  try {
    return await fn();
  } catch (err) {
    logger.error(`[IMS] safeQuery failed:`, err.message);
    return null;
  }
}

export const dashboardService = {
  async adminStats() {
    const [
      totalInterns,
      activeInterns,
      completed,
      archived,
      pendingEvals,
      attendanceToday,
    ] = await Promise.all([
      count("interns"),
      count("interns", (q) => q.eq("status", "active")),
      count("interns", (q) => q.eq("status", "completed")),
      count("interns", (q) => q.eq("status", "archived")),
      // NOTE: `neq` on an enum column can be rejected by the gateway in some
      // configurations. Compute "pending" (the only other live status) and
      // treat that as the pending-evaluation count instead of `neq.completed`.
      count("evaluations", (q) => q.eq("status", "pending")),
      count("attendance", (q) => q.eq("date", todayDateInAttendanceTZ())),
    ]);
    return {
      totalInterns,
      activeInterns,
      completedInternships: completed,
      archivedInterns: archived,
      pendingEvaluations: pendingEvals,
      attendanceToday,
    };
  },

  async supervisorStats(supervisorId) {
    // `attendance` has no supervisor_id column (only intern_id), so count
    // today's attendance via the supervisor's assigned interns.
    //
    // Scope MUST match SupervisorInterns: internService.list filters on
    // `supervisor_id = me` and applies NO status filter, so archived and
    // completed interns are still listed as assigned. The old card added
    // `.eq("status", "active")` here, so an intern the admin had archived
    // showed on /supervisor/interns but counted 0 on the dashboard
    // ("Assigned Interns 0" while the list showed 1). Keep every status.
    const { data: internRows, error: internErr } = await supabase
      .from("interns")
      .select("id")
      .eq("supervisor_id", supervisorId);
    if (internErr)
      return {
        assignedInterns: 0,
        archivedInterns: 0,
        attendanceToday: 0,
        pendingJournals: 0,
        pendingEvaluations: 0,
      };
    const internIds = (internRows ?? []).map((i) => i.id);
    const today = todayDateInAttendanceTZ();
    const [
      assigned,
      archivedCount,
      attendanceToday,
      pendingJournals,
      pendingEvals,
    ] = await Promise.all([
      // Total assigned (all statuses, incl. archived) — matches /supervisor/interns.
      count("interns", (q) => q.eq("supervisor_id", supervisorId)),
      // Of those, how many are currently archived (shown on the dashboard so a
      // supervisor can see when the admin archived one of their interns).
      count("interns", (q) =>
        q.eq("supervisor_id", supervisorId).eq("status", "archived"),
      ),
      internIds.length
        ? count("attendance", (q) =>
            q.in("intern_id", internIds).eq("date", today),
          )
        : Promise.resolve(0),
      count("daily_journals", (q) =>
        q.eq("supervisor_id", supervisorId).eq("status", "pending"),
      ),
      count("evaluations", (q) =>
        q.eq("supervisor_id", supervisorId).eq("status", "pending"),
      ),
    ]);
    return {
      assignedInterns: assigned,
      archivedInterns: archivedCount,
      attendanceToday,
      pendingJournals,
      pendingEvaluations: pendingEvals,
    };
  },

  async internStats(internId) {
    const today = todayDateInAttendanceTZ();
    const results = await Promise.all([
      internId
        ? safeQuery(() =>
            supabase
              .from("attendance")
              .select("total_hours")
              .eq("intern_id", internId),
          ).then((r) => r?.data ?? [])
        : Promise.resolve([]),
      internId
        ? safeQuery(() =>
            supabase
              .from("interns")
              .select("required_hours")
              .eq("id", internId)
              .single(),
          ).then((r) => r?.data?.required_hours ?? 0)
        : Promise.resolve(0),
      count("attendance", (q) => q.eq("intern_id", internId).eq("date", today)),
      count("announcements"),
    ]);

    const hoursRows = results[0];
    const required = results[1];
    const attendanceToday = results[2];
    const announcements = results[3];

    const rendered = (hoursRows ?? []).reduce(
      (sum, r) => sum + (Number(r.total_hours) || 0),
      0,
    );
    const requiredHours = Number(required) || 0;
    return {
      hoursRendered: Math.round(rendered * 100) / 100,
      requiredHours,
      remainingHours: Math.max(0, requiredHours - rendered),
      todayAttendance: attendanceToday,
      latestAnnouncements: announcements,
    };
  },
};
