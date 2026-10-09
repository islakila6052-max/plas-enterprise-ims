// src/services/departmentService.js
import { supabase } from "@/lib/supabase";

export const departmentService = {
  async list() {
    try {
      const { data, error } = await supabase
        .from("departments")
        .select("*")
        .order("name", { ascending: true });

      if (error) throw new Error(error.message);
      return data ?? [];
    } catch (err) {
      throw err;
    }
  },

  async getById(id) {
    try {
      const { data, error } = await supabase
        .from("departments")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw new Error(error.message);
      return data;
    } catch (err) {
      throw err;
    }
  },

  async create(payload) {
    try {
      const { data, error } = await supabase
        .from("departments")
        .insert(payload)
        .select()
        .single();

      if (error) {
        // Check for duplicate department name constraint
        if (error.message && error.message.includes("departments_name_key")) {
          throw new Error("A department with this name already exists.");
        }
        throw new Error(error.message);
      }
      return data;
    } catch (err) {
      throw err;
    }
  },

  async update(id, payload) {
    try {
      const { data, error } = await supabase
        .from("departments")
        .update(payload)
        .eq("id", id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    } catch (err) {
      throw err;
    }
  },

  async remove(id) {
    try {
      const { error } = await supabase
        .from("departments")
        .delete()
        .eq("id", id);

      if (error) throw new Error(error.message);
      return;
    } catch (err) {
      throw err;
    }
  },
};