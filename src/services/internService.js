import { supabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { PAGE_SIZE } from "@/lib/constants";
import { sanitizeSearch } from "@/utils/format";
import { userService } from "@/services/userService";

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

export const internService = {
  async list({
    search = "",
    departmentId = "",
    status = "",
    supervisorId = "", // NEW: Add supervisorId parameter
    createdBy = "", // NEW: interns created by this user (OR with supervisorId)
    institutionId = "", // NEW: filter by linked institution
    programId = "", // NEW: filter by linked program
    createdFrom = "", // NEW: filter by created_at >= date
    createdTo = "", // NEW: filter by created_at <= date
    page = 1,
    pageSize = PAGE_SIZE,
  } = {}) {
    let query = supabase
        .from("interns")
        .select(
          "*, department:departments(name), supervisor:supervisors(full_name, email), institution:institutions(institution_name), program:programs(program_name, abbreviation)",
          { count: "exact" },
        )
        .order("created_at", { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);

      if (search) {
        // M2: sanitise before interpolating into the PostgREST filter string.
        const term = sanitizeSearch(search);
        if (term) {
          query = query.or(
            `first_name.ilike.%${term}%,last_name.ilike.%${term}%,full_name.ilike.%${term}%`,
          );
        }
      }
      if (departmentId) query = query.eq("department_id", departmentId);
      if (status) query = query.eq("status", status);
      if (institutionId) query = query.eq("institution_id", institutionId);
      if (programId) query = query.eq("program_id", programId);
      if (createdFrom) query = query.gte("created_at", createdFrom);
      if (createdTo) query = query.lte("created_at", createdTo);
      // Supervisors see interns assigned to them OR created by them.
      if (supervisorId && createdBy) {
        query = query.or(`supervisor_id.eq.${supervisorId},created_by.eq.${createdBy}`);
      } else if (supervisorId) {
        query = query.eq("supervisor_id", supervisorId);
      } else if (createdBy) {
        query = query.eq("created_by", createdBy);
      }

      const { data, error, count } = await query;
      if (error) throw new Error(error.message);
      return { data: data ?? [], count: count ?? 0, page, pageSize };
  },

  async get(id) {
    const { data, error } = await supabase
      .from("interns")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  async create(payload) {
    // Upsert on profile_id so re-running creation (e.g. double-click) does not
    // 409 on the interns_profile_id_key unique constraint.
    const { data, error } = await supabase
      .from("interns")
      .upsert(payload, { onConflict: "profile_id" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  async update(id, payload) {
    const { data, error } = await supabase
      .from("interns")
      .update(payload)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  async remove(id) {
    // Fetch the linked profile (auth user) id before deleting the intern.
    const { data: internRow, error: fetchErr } = await supabase
      .from("interns")
      .select("profile_id")
      .eq("id", id)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);

    // Delete the intern row. FK ON DELETE CASCADE removes attendance,
    // daily_journals, documents and evaluations for this intern automatically.
    const { error } = await supabase.from("interns").delete().eq("id", id);
    if (error) throw new Error(error.message);

    // Hard-delete the linked auth user so the account can no longer log in.
    // profiles.id cascades to the profile row; intern children are already gone.
    if (internRow?.profile_id) {
      try {
        await userService.deleteAuthUser(internRow.profile_id);
      } catch (e) {
        // Non-fatal: the intern data is already removed. Surface but don't fail
        // the whole operation if the auth delete is blocked for any reason.
        logger.error("Intern auth user delete failed:", e);
      }
    }
    return;
  },

  /** Soft-archive by flipping status. */
  async archive(id) {
    return this.update(id, { status: "archived" });
  },

  async restore(id) {
    return this.update(id, { status: "active" });
  },

  /**
   * Fetch intern stats with graceful degradation.
   * Returns safe defaults on network failure.
   */
  async getStats(internId) {
    if (!internId) return { totalInterns: 0, activeInterns: 0, completed: 0 };

    const [totalResult, activeResult, completedResult] = await Promise.all([
      safeQuery(() =>
        supabase.from("interns").select("*", { count: "exact", head: true })
      ),
      safeQuery(() =>
        supabase.from("interns").select("*", { count: "exact", head: true }).eq("status", "active")
      ),
      safeQuery(() =>
        supabase.from("interns").select("*", { count: "exact", head: true }).eq("status", "completed")
      ),
    ]);

    return {
      totalInterns: totalResult?.count ?? 0,
      activeInterns: activeResult?.count ?? 0,
      completedInternships: completedResult?.count ?? 0,
    };
  },
};