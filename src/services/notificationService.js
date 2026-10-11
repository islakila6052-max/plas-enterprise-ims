// src/services/notificationService.js
import { supabase } from "@/lib/supabase";

/**
 * Notification service. Notifications are per-user (profiles.id) and track
 * read state. Data is written to the Supabase `notifications` table.
 *
 * Table columns (see DATABASE_SCHEMA.md):
 *   id, user_id, type, title, message, link, is_read, read_at, metadata, created_at
 */

export const notificationService = {
  /** List notifications for a user, newest first. */
  async list({ userId, onlyUnread = false, limit = 50 } = {}) {
    let query = supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (onlyUnread) query = query.eq("is_read", false);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data ?? [];
  },

  /** Count of unread notifications for a user. */
  async unreadCount(userId) {
    const { count, error } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_read", false);
    if (error) return 0;
    return count ?? 0;
  },

  /** Mark a single notification as read. */
  async markRead(id) {
    const { data, error } = await supabase
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  /** Mark every notification for a user as read. */
  async markAllRead(userId) {
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("is_read", false);
    if (error) throw new Error(error.message);
    return;
  },
};
