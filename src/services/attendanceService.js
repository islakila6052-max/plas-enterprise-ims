// src/services/attendanceService.js
import { supabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { todayDateInAttendanceTZ } from "@/utils/format";

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
 * Attendance service. Time in/out, manual check-in, history and hour computation.
 * All data is sourced from Supabase.
 */

export const attendanceService = {
  /** Open (no time_out) attendance record for an intern today, if any. */
  async getOpen(internId) {
    if (!internId) return null;
    const today = todayDateInAttendanceTZ();
    const { data, error } = await supabase
      .from("attendance")
      .select("*")
      .eq("intern_id", internId)
      .eq("date", today)
      .is("time_out", null)
      .maybeSingle();
    if (error) return null;
    return data;
  },

  /** Today's attendance record (open or closed) for an intern, if any. */
  async getToday(internId) {
    if (!internId) return null;
    const today = todayDateInAttendanceTZ();
    const { data, error } = await supabase
      .from("attendance")
      .select("*")
      .eq("intern_id", internId)
      .eq("date", today)
      .maybeSingle();
    if (error) return null;
    return data;
  },

  /**
   * SECURITY (H2): this used to decide `present` vs `late` in the BROWSER and
   * the value was written straight to the row, so a client could simply claim
   * `present` for a late arrival. The decision now lives in the
   * `attendance_clock_in` SQL function, which derives the status from the
   * SERVER clock and the `settings.shift_start_minute` value. `internId` is
   * likewise ignored by the RPC: the row is always bound to
   * `current_intern_id()`.
   */
  async timeIn(internId, method = "manual") {
    // H2: the insert now happens inside the `attendance_clock_in` RPC, which
    // derives `status` (present/late) from the SERVER clock and enforces the
    // one-record-per-day rule. A client can no longer assert its own status.
    //
    // The payload must stay EXACTLY `{ p_method }`: PostgREST resolves an RPC
    // by the argument names it is given, so sending a null/empty value (or a
    // differently named key) would not match `attendance_clock_in(text)` and
    // would surface as "Could not find the function ...(p_method)". The
    // `|| "manual"` fallback guarantees a non-empty string.
    const { data, error } = await supabase.rpc("attendance_clock_in", {
      p_method: method || "manual",
    });
    if (error) {
      // 23505 = the daily duplicate check tripped inside the function.
      if (error.code === "23505") {
        throw new Error(
          "You have already submitted your attendance for today.",
        );
      }
      // PGRST202 / 42883 = the function is missing from the PostgREST schema
      // cache (never created, or the cache was not reloaded after creation).
      // 404 = the same condition seen by the browser. Surface an actionable
      // message instead of the raw "Could not find the function" text.
      if (
        error.code === "PGRST202" ||
        error.code === "42883" ||
        /schema cache|Could not find the function/i.test(error.message ?? "")
      ) {
        throw new Error(
          "Time In is temporarily unavailable: the server is missing the attendance function. Please contact an administrator.",
        );
      }
      // 42501 = insufficient_privilege raised when the auth account has no
      // linked intern row.
      if (error.code === "42501") {
        throw new Error(
          "Your intern profile isn't linked yet. Please contact an administrator.",
        );
      }
      throw new Error(error.message);
    }
    return data;
  },

  // src/services/attendanceService.js (partial update - replace the timeOut method)

  // src/services/attendanceService.js

  async timeOut(recordId, timeOutISO, remarks = null) {
    // H2: `attendance_clock_out` closes the caller's own open record for today
    // and computes `total_hours` in the database. The client can no longer post
    // an arbitrary duration, nor target another intern's record.
    const { data, error } = await supabase.rpc("attendance_clock_out", {
      p_time_out: timeOutISO,
      p_remarks: remarks || null,
    });
    if (error) {
      if (error.code === "P0002" || /open attendance record/i.test(error.message)) {
        throw new Error("You do not have an open attendance record to close.");
      }
      throw new Error(error.message);
    }
    return data;
  },

  /**
   * Submit a missed clock-out claim for an attendance record that has a
   * time_in but no time_out. The claim is subject to supervisor approval.
   * @param {string} recordId - Attendance record id
   * @param {string} claimedTimeOutISO - ISO timestamp the intern claims they left
   * @param {string} remarks - Reason for the missed clock-out
   */
  async submitClaim(recordId, claimedTimeOutISO, remarks) {
    // H2: all pre-checks (record exists, no time_out yet, no pending claim,
    // claimed time after time_in) now run server-side inside the function, so
    // they cannot be bypassed by calling the API directly.
    const { data, error } = await supabase.rpc("attendance_submit_claim", {
      p_record_id: recordId,
      p_claimed_time_out: claimedTimeOutISO,
      p_remarks: remarks || null,
    });
    if (error) throw new Error(error.message);
    return data;
  },

  /**
   * Review a missed clock-out claim. On approval, the claimed time becomes
   * the official time_out and total_hours are recomputed.
   * @param {string} recordId - Attendance record id
   * @param {"approved"|"rejected"} decision - Approve or reject the claim
   * @param {string} reviewerProfileId - Profile id of the reviewing supervisor
   * @param {string} [comment] - Optional supervisor comment
   */
  async reviewClaim(recordId, decision, reviewerProfileId, comment = null) {
    // H2: `attendance_review_claim` takes the reviewer identity from the JWT
    // (NOT from this argument), verifies the intern is actually assigned to the
    // caller, and computes time_out / total_hours / status server-side. An
    // intern can no longer self-approve a claim or flip status back to present.
    const { data, error } = await supabase.rpc("attendance_review_claim", {
      p_record_id: recordId,
      p_decision: decision,
      p_comment: comment || null,
    });
    if (error) throw new Error(error.message);
    return data;
  },

  async list({ internId, date, page = 1, pageSize = 15 } = {}) {
    let query = supabase
      .from("attendance")
      .select("*", { count: "exact" })
      .order("date", { ascending: false })
      .order("time_in", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (internId) query = query.eq("intern_id", internId);
    if (date) query = query.eq("date", date);
    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    return { data: data ?? [], count: count ?? 0 };
  },

  /**
   * Read-only fetch of attendance rows for ONE intern across a date range.
   * Backs the Daily Time Record.
   *
   * This is deliberately a SELECT and nothing else. Generating a DTR must never
   * create a row, change an hour count, or back-date anything, so there is no
   * write path anywhere near this method. The existing Time In / Time Out
   * functions are untouched.
   *
   * OWNERSHIP IS ENFORCED BY THE DATABASE, NOT HERE. The policy
   * `attendance readable scoped` (migration 0045) allows a row only when
   * intern_id = current_intern_id(), i.e. the intern resolved from the caller's
   * own JWT. So even if a caller hand-crafted a request with someone else's
   * internId, Postgres returns zero rows rather than another intern's data.
   * The `internId` argument is supplied by the UI from the signed-in intern's
   * own profile - never from a URL parameter or user input.
   */
  async listForRange({ internId, from, to }) {
    if (!internId || !from || !to || from > to) return [];

    const { data, error } = await supabase
      .from("attendance")
      .select("id, date, time_in, time_out, total_hours, method, status, remarks")
      .eq("intern_id", internId)
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: true });

    if (error) throw new Error(error.message);
    return data ?? [];
  },

  async adminList({
    dateFrom,
    dateTo,
    internId,
    status,
    supervisorId,
    page = 1,
    pageSize = 15,
  } = {}) {
    let query = supabase
      .from("attendance")
      .select("*, intern:interns(first_name, last_name, full_name, supervisor_id)", {
        count: "exact",
      })
      .order("date", { ascending: false })
      .order("time_in", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (dateFrom) query = query.gte("date", dateFrom);
    if (dateTo) query = query.lte("date", dateTo);
    if (internId) query = query.eq("intern_id", internId);
    if (status) query = query.eq("status", status);
    // Filter to this supervisor's interns server-side (the embedded
    // intern.supervisor_id column is what the UI previously read client-side).
    if (supervisorId) query = query.eq("intern.supervisor_id", supervisorId);
    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    return { data: data ?? [], count: count ?? 0 };
  },

  /**
   * Fetch attendance stats with graceful degradation.
   * Returns safe defaults on network failure.
   */
  async getStats(internId) {
    if (!internId) return { presentToday: 0, totalHours: 0 };

    const today = todayDateInAttendanceTZ();
    const [attendanceResult, hoursResult] = await Promise.all([
      safeQuery(() =>
        supabase
          .from("attendance")
          .select("*", { count: "exact", head: true })
          .eq("intern_id", internId)
          .eq("date", today),
      ),
      safeQuery(() =>
        supabase
          .from("attendance")
          .select("total_hours")
          .eq("intern_id", internId),
      ),
    ]);

    const totalHours = (hoursResult?.data ?? []).reduce(
      (sum, r) => sum + (Number(r.total_hours) || 0),
      0,
    );

    return {
      presentToday: attendanceResult?.count ?? 0,
      totalHours: Math.round(totalHours * 100) / 100,
    };
  },
};