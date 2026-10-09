// src/services/programService.js
import { supabase } from "@/lib/supabase";
import { sanitizeSearch } from "@/utils/format";

/**
 * Program service. Programs belong to an institution (1:N). Admin-only writes;
 * authenticated users can read.
 */
const COLUMNS = [
  "program_id",
  "institution_id",
  "program_name",
  "abbreviation",
  "program_code",
  "required_hours",
  "created_at",
  "updated_at",
];

export const programService = {
  // src/services/programService.js
  async list({ institutionId = "", search = "" } = {}) {
    try {
      let query = supabase
        .from("programs")
        .select(
          "program_id, program_name, abbreviation, program_code, required_hours, institution_id",
        )
        .order("program_name", { ascending: true });

      if (institutionId) query = query.eq("institution_id", institutionId);
      if (search) {
        // M2: sanitise before interpolating into the PostgREST filter string.
        const term = sanitizeSearch(search);
        if (term) {
          query = query.or(
            `program_name.ilike.%${term}%,program_code.ilike.%${term}%,abbreviation.ilike.%${term}%`,
          );
        }
      }
      const { data, error } = await query;
      if (error) throw new Error(error.message);

      // Return distinct programs by name (keep first occurrence)
      const seen = new Set();
      const distinct = (data ?? []).filter((p) => {
        const name = (p.program_name || "").trim().toLowerCase();
        if (!name || seen.has(name)) return false;
        seen.add(name);
        return true;
      });

      return distinct;
    } catch (err) {
      throw err;
    }
  },

  async getById(id) {
    const { data, error } = await supabase
      .from("programs")
      .select(COLUMNS.join(","))
      .eq("program_id", id)
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  _payload(p) {
    return {
      institution_id: p.institution_id,
      program_name: p.program_name,
      abbreviation: p.abbreviation || null,
      program_code: p.program_code || null,
      required_hours: Number(p.required_hours) || 0,
    };
  },

  async create(payload) {
    const { data, error } = await supabase
      .from("programs")
      .insert(this._payload(payload))
      .select(COLUMNS.join(","))
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  async update(id, payload) {
    const { data, error } = await supabase
      .from("programs")
      .update(this._payload(payload))
      .eq("program_id", id)
      .select(COLUMNS.join(","))
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  async remove(id) {
    const { error } = await supabase
      .from("programs")
      .delete()
      .eq("program_id", id);
    if (error) throw new Error(error.message);
  },

  /**
   * Reconcile the full set of programs for an institution: insert new ones,
   * update existing ones (matched by program_id), and delete removed ones.
   * Used by the institution modal so an admin can manage programs inline.
   *
   * @param {string} institutionId
   * @param {Array}  programs  [{ program_id?, program_name, abbreviation?, program_code?, required_hours }]
   */
  async reconcile(institutionId, programs = []) {
    const existing = await this.list({ institutionId });
    const incomingIds = new Set(
      programs.filter((p) => p.program_id).map((p) => p.program_id),
    );

    // Delete programs that are no longer present.
    for (const p of existing) {
      if (!incomingIds.has(p.program_id)) await this.remove(p.program_id);
    }

    // Upsert incoming programs.
    for (const p of programs) {
      const payload = { ...this._payload(p), institution_id: institutionId };
      if (p.program_id) await this.update(p.program_id, payload);
      else await this.create(payload);
    }
  },
};
