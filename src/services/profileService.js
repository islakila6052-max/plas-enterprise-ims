// src/services/profileService.js
import { supabase } from "@/lib/supabase";
import { sanitizeSearch } from "@/utils/format";

/**
 * Profile service. Profiles store the user's role and identity, linked 1:1 to auth.users.
 * All data is sourced from the configured Supabase project.
 */

export const profileService = {
  /** Fetch the profile row for a given auth user id. */
  async getByUserId(userId) {
    if (!userId) return null;
    // NOTE: use an explicit column list (not select("*")). The profiles table
    // has a circular FK to supervisors (profiles.supervisor_id <>
    // supervisors.profile_id), and PostgREST returns 406 "could not serialize"
    // for select("*") on such tables. Explicit columns avoid that.
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id, full_name, email, avatar_url, contact_number, bio, role, intern_id, supervisor_id, created_at, updated_at",
      )
      .eq("id", userId)
      .single();
    if (error) {
      if (error.code === "PGRST116") return null;
      throw new Error(error.message);
    }
    return data;
  },

  /**
   * Update the CURRENT user's own profile.
   *
   * SECURITY (migration 0045): this no longer performs a direct
   * `profiles.update()`, which let any authenticated caller write ANY column of
   * their own row — including `role`, a full self-promotion to admin. It now
   * calls the `update_own_profile` SECURITY DEFINER RPC, which whitelists
   * full_name / contact_number / bio / avatar_url and resolves the target row
   * from `auth.uid()` server-side, so `role`, `email`, `intern_id` and
   * `supervisor_id` are unreachable from the client entirely.
   *
   * Admin edits of OTHER profiles still go through the RLS
   * "admins manage profiles" policy and are unaffected.
   */
  async update(updates) {
    const { data, error } = await supabase.rpc("update_own_profile", {
      p_full_name: updates.full_name ?? null,
      p_contact_number: updates.contact_number ?? null,
      p_bio: updates.bio ?? null,
      p_avatar_url: updates.avatar_url ?? null,
    });
    if (error) throw new Error(error.message);
    return data;
  },

  /** List all profiles (admin). */
  async list({ role, search, limit = 50, offset = 0 } = {}) {
    let query = supabase
      .from("profiles")
      .select(
        "id, full_name, email, avatar_url, contact_number, bio, role, intern_id, supervisor_id, created_at, updated_at",
        { count: "exact" },
      )
      .order("full_name", { ascending: true })
      .range(offset, offset + limit - 1);
    if (role) query = query.eq("role", role);
    if (search) {
      // M2: sanitise before interpolating into the PostgREST filter string.
      const term = sanitizeSearch(search);
      if (term) query = query.ilike("full_name", `%${term}%`);
    }
    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    return { data: data ?? [], count: count ?? 0 };
  },
};
