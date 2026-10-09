// src/services/journalService.js
import { supabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";

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

export const journalService = {
  async list({ internId, status, supervisorId, dateFrom, dateTo, departmentId, page = 1, pageSize = 15 } = {}) {
    // Embed the supervisor so the intern can see WHO left the feedback, not just
    // the text. Previously only `intern` was embedded, so an intern reading a
    // `supervisor_comment` had no way to attribute it.
    let query = supabase
      .from("daily_journals")
      .select(
        "*, intern:interns(full_name, last_name, profile_id, department:departments(id, name)), supervisor:supervisors(id, full_name, first_name, last_name)",
        { count: "exact" },
      )
      .order("date", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (internId) query = query.eq("intern_id", internId);
    if (status) query = query.eq("status", status);
    if (supervisorId) query = query.eq("supervisor_id", supervisorId);
    if (dateFrom) query = query.gte("date", dateFrom);
    if (dateTo) query = query.lte("date", dateTo);
    if (departmentId) query = query.eq("intern.department_id", departmentId);
    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    return { data: data ?? [], count: count ?? 0 };
  },

  async create(payload) {
    // Resolve supervisor_id from the intern's record when not provided,
    // so the supervisor's journal list (filtered by supervisor_id) sees it.
    const finalPayload = { ...payload };
    if (!finalPayload.supervisor_id && finalPayload.intern_id) {
      const { data: intern } = await supabase
        .from("interns")
        .select("supervisor_id")
        .eq("id", finalPayload.intern_id)
        .single();
      if (intern?.supervisor_id) finalPayload.supervisor_id = intern.supervisor_id;
    }
    const { data, error } = await supabase.from("daily_journals").insert(finalPayload).select("*").single();
    if (error) throw new Error(error.message);
    return data;
  },

  async review(id, status, supervisorId, comment) {
    // H2: reviewing now goes through the `journal_review` RPC, which verifies
    // the caller is the intern's assigned supervisor (or an admin) and keeps
    // `intern_id` immutable. Previously an intern could set their own journal
    // `status` to 'approved' and forge a supervisor comment.
    const { data, error } = await supabase.rpc("journal_review", {
      p_journal_id: id,
      p_status: status,
      p_comment: comment || null,
    });
    if (error) throw new Error(error.message);
    return data;
  },

  /**
   * Fetch journal stats with graceful degradation.
   * Returns safe defaults on network failure.
   */
  async getStats(internId) {
    if (!internId) return { totalJournals: 0, pendingCount: 0 };

    const [totalResult, pendingResult] = await Promise.all([
      safeQuery(() =>
        supabase.from("daily_journals").select("*", { count: "exact", head: true }).eq("intern_id", internId)
      ),
      safeQuery(() =>
        supabase.from("daily_journals").select("*", { count: "exact", head: true }).eq("intern_id", internId).eq("status", "pending")
      ),
    ]);

    return {
      totalJournals: totalResult?.count ?? 0,
      pendingCount: pendingResult?.count ?? 0,
    };
  },
};