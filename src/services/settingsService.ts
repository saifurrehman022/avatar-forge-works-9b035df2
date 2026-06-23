import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type GeneralSettings = TablesInsert<"user_settings_general">;
export type PublishingDefaults = TablesInsert<"publishing_defaults">;
export type SyncSettings = TablesInsert<"sync_settings">;
export type NotificationSettings = TablesInsert<"notification_settings">;

export const settingsService = {
  // ---------- General ----------
  async getGeneral(userId: string) {
    const { data, error } = await supabase
      .from("user_settings_general")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  async upsertGeneral(payload: GeneralSettings) {
    const { data, error } = await supabase
      .from("user_settings_general")
      .upsert(payload, { onConflict: "user_id" })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // ---------- Publishing defaults ----------
  async getPublishingDefaults(userId: string) {
    const { data, error } = await supabase
      .from("publishing_defaults")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  async upsertPublishingDefaults(payload: PublishingDefaults) {
    const { data, error } = await supabase
      .from("publishing_defaults")
      .upsert(payload, { onConflict: "user_id" })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // ---------- Sync ----------
  async getSync(userId: string) {
    const { data, error } = await supabase
      .from("sync_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  async upsertSync(payload: SyncSettings) {
    const { data, error } = await supabase
      .from("sync_settings")
      .upsert(payload, { onConflict: "user_id" })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // ---------- Notifications ----------
  async getNotifications(userId: string) {
    const { data, error } = await supabase
      .from("notification_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  async upsertNotifications(payload: NotificationSettings) {
    const { data, error } = await supabase
      .from("notification_settings")
      .upsert(payload, { onConflict: "user_id" })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};
