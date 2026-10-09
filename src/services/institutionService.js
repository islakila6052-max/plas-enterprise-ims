// src/services/institutionService.js
import { supabase } from "@/lib/supabase";
import { sanitizeSearch } from "@/utils/format";

/**
 * Institution service. Institutions are master setup data (schools / universities)
 * that own academic programs. Admin-only writes; authenticated users can read.
 * All data is sourced from Supabase.
 */
const COLUMNS = [
  "institution_id",
  "institution_name",
  "abbreviation",
  "campus",
  "address",
  "contact_person",
  "contact_number",
  "email",
  "logo_url",
  "created_at",
  "updated_at",
];

export const institutionService = {
  async list({ search = "" } = {}) {
    try {
      let query = supabase
        .from("institutions")
        .select(COLUMNS.join(","))
        .order("institution_name", { ascending: true });
      if (search) {
        // M2: sanitise before interpolating into the PostgREST filter string.
        const term = sanitizeSearch(search);
        if (term) {
          query = query.or(
            `institution_name.ilike.%${term}%,abbreviation.ilike.%${term}%,campus.ilike.%${term}%`,
          );
        }
      }
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data ?? [];
    } catch (err) {
      throw err;
    }
  },

  async getById(id) {
    const { data, error } = await supabase
      .from("institutions")
      .select(COLUMNS.join(","))
      .eq("institution_id", id)
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  _payload(p) {
    // Build the full shape, then DROP any key that is `undefined`.
    // This is critical: callers like update(id, { logo_url }) must NOT
    // accidentally null out every other column. Supabase serializes
    // `undefined` keys as absent (safe) but `null` as an explicit NULL,
    // so we must never let an unprovided field become `null`.
    const raw = {
      institution_name: p.institution_name,
      abbreviation: p.abbreviation,
      campus: p.campus,
      address: p.address,
      contact_person: p.contact_person,
      contact_number: p.contact_number,
      email: p.email,
      logo_url: p.logo_url,
    };
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v !== undefined) out[k] = v;
    }
    return out;
  },

  async create(payload) {
    const { data, error } = await supabase
      .from("institutions")
      .insert(this._payload(payload))
      .select(COLUMNS.join(","))
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  async update(id, payload) {
    const { data, error } = await supabase
      .from("institutions")
      .update(this._payload(payload))
      .eq("institution_id", id)
      .select(COLUMNS.join(","))
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  async remove(id) {
    const { error } = await supabase.from("institutions").delete().eq("institution_id", id);
    if (error) throw new Error(error.message);
  },

  /**
   * Upload an institution logo to the public `institution-logos` bucket and
   * return its public URL. Admin-only (enforced by storage RLS).
   */
  async uploadLogo(file, institutionId) {
    const path = `${institutionId || "shared"}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage
      .from("institution-logos")
      .upload(path, file, { upsert: true, contentType: file.type || "image/*" });
    if (error) throw new Error(error.message);
    return this.getLogoUrl(path);
  },

  /** Resolve a stored logo path to its public URL. */
  getLogoUrl(path) {
    if (!path) return null;
    if (path.startsWith("http")) return path;
    const { data } = supabase.storage.from("institution-logos").getPublicUrl(path);
    return data?.publicUrl ?? null;
  },

  /** Delete a previously stored logo (admin-only). */
  async removeLogo(path) {
    if (!path || path.startsWith("http")) return;
    await supabase.storage.from("institution-logos").remove([path]);
  },
};
