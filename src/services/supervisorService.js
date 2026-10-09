// supervisorService.js
import { supabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { userService } from "@/services/userService";

export const supervisorService = {
  async list() {
    const { data, error } = await supabase
      .from("supervisors")
      .select(
        `
        *,
        profile:profile_id (
          full_name,
          email
        ),
        department:departments (
          name
        )
      `,
      )
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }
    return data ?? [];
  },

  async getById(id) {
    if (!id) return null;
    const { data, error } = await supabase
      .from("supervisors")
      .select(
        `
        *,
        profile:profile_id (
          full_name,
          email
        ),
        department:departments (
          name
        )
      `,
      )
      .eq("id", id)
      .single();

    if (error) {
      throw new Error(error.message);
    }
    return data ?? null;
  },

  /** Resolve a supervisor record by its linked profile (auth user) id. */
  async getByProfileId(profileId) {
    if (!profileId) return null;
    const { data, error } = await supabase
      .from("supervisors")
      .select(
        `
        *,
        profile:profile_id (
          full_name,
          email
        ),
        department:departments (
          name
        )
      `,
      )
      .eq("profile_id", profileId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }
    return data ?? null;
  },

  async create(payload) {
    // Upsert on profile_id so re-running creation (e.g. double-click, or a
    // partial failure that left a row behind) does not 409 on the
    // supervisors_profile_id_key unique constraint.
    const { data, error } = await supabase
      .from("supervisors")
      .upsert(
        {
          profile_id: payload.profile_id,
          department_id: payload.department_id,
          first_name: payload.first_name,
          last_name: payload.last_name,
          email: payload.email,
          created_by: payload.created_by,
        },
        { onConflict: "profile_id" },
      )
      .select(
        `
        *,
        profile:profile_id (
          full_name,
          email
        ),
        department:departments (
          name
        )
      `,
      )
      .single();

    if (error) {
      throw new Error(error.message);
    }

    // Manually update profile with supervisor_id (only if we have a profile link).
    if (data?.profile_id) {
      await supabase
        .from("profiles")
        .update({ supervisor_id: data.id })
        .eq("id", data.profile_id);
    }

    return data;
  },

  async update(id, payload) {
    const updateData = {
      department_id: payload.department_id,
      first_name: payload.first_name,
      last_name: payload.last_name,
      email: payload.email,
    };

    const { data, error } = await supabase
      .from("supervisors")
      .update(updateData)
      .eq("id", id)
      .select(
        `
        *,
        profile:profile_id (
          full_name,
          email
        ),
        department:departments (
          name
        )
      `,
      )
      .single();

    if (error) {
      throw new Error(error.message);
    }

    // Also update profile if name or email changed. profiles keeps a single
    // combined full_name; the supervisors row stores first_name / last_name.
    const fullName = [payload.first_name, payload.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (fullName || payload.email) {
      const profileUpdate = {};
      if (fullName) profileUpdate.full_name = fullName;
      if (payload.email) profileUpdate.email = payload.email;

      if (data?.profile_id && Object.keys(profileUpdate).length > 0) {
        await supabase
          .from("profiles")
          .update(profileUpdate)
          .eq("id", data.profile_id);
      }
    }

    return data;
  },

  async remove(id) {
    // Fetch the linked profile (auth user) id before deleting the supervisor.
    const { data: supData, error: fetchError } = await supabase
      .from("supervisors")
      .select("profile_id")
      .eq("id", id)
      .single();
    if (fetchError) throw new Error(fetchError.message);

    // Delete the supervisor's OWN child records explicitly. The FKs from these
    // tables to supervisors are ON DELETE SET NULL (not cascade), so we must
    // remove them here to fully clear the supervisor's data.
    // Interns are NOT deleted — they are distinct people; their supervisor_id
    // is set to NULL by the FK, preserving their records.
    await supabase.from("evaluations").delete().eq("supervisor_id", id);
    await supabase.from("daily_journals").delete().eq("supervisor_id", id);
    if (supData?.profile_id) {
      await supabase.from("notifications").delete().eq("user_id", supData.profile_id);
    }

    // Delete the supervisor record.
    const { error: deleteError } = await supabase
      .from("supervisors")
      .delete()
      .eq("id", id);
    if (deleteError) throw new Error(deleteError.message);

    // Hard-delete the linked auth user so the account can no longer log in.
    if (supData?.profile_id) {
      try {
        await userService.deleteAuthUser(supData.profile_id);
      } catch (e) {
        logger.error("Supervisor auth user delete failed:", e);
      }
    }

    return;
  },
};
