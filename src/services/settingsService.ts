import { supabase } from "@/integrations/supabase/client";

// ============ Types ============
export interface GeneralSettings {
  theme: "dark" | "light" | "system";
  compact_mode: boolean;
  landing_page: string;
  default_fps: number;
  default_scenes: number;
  default_steps: number;
  manual_approval: boolean;
  auto_publish: boolean;
  retry_failed: boolean;
  store_history: boolean;
  retain_rejected: boolean;
}

export interface PublishingDefaultsRow {
  default_visibility: "public" | "subscribers" | "premium";
  default_category: string;
  default_price: number;
  watermark_enabled: boolean;
  auto_publish: boolean;
}

export interface NotificationSettingsRow {
  generation_email: boolean;
  generation_browser: boolean;
  generation_in_app: boolean;
  publishing_email: boolean;
  publishing_browser: boolean;
  publishing_in_app: boolean;
  failed_upload_email: boolean;
  failed_upload_browser: boolean;
  failed_upload_in_app: boolean;
  system_alerts_email: boolean;
  system_alerts_browser: boolean;
  system_alerts_in_app: boolean;
}

export interface SyncSettingsRow {
  auto_sync: boolean;
  sync_interval_minutes: number;
  retry_uploads: boolean;
}

// ============ Defaults ============
export const defaultGeneral: GeneralSettings = {
  theme: "dark",
  compact_mode: false,
  landing_page: "/",
  default_fps: 16,
  default_scenes: 10,
  default_steps: 29,
  manual_approval: true,
  auto_publish: false,
  retry_failed: true,
  store_history: true,
  retain_rejected: false,
};

export const defaultPublishing: PublishingDefaultsRow = {
  default_visibility: "subscribers",
  default_category: "lifestyle",
  default_price: 0,
  watermark_enabled: true,
  auto_publish: false,
};

export const defaultNotifications: NotificationSettingsRow = {
  generation_email: false,
  generation_browser: true,
  generation_in_app: true,
  publishing_email: true,
  publishing_browser: true,
  publishing_in_app: true,
  failed_upload_email: true,
  failed_upload_browser: true,
  failed_upload_in_app: true,
  system_alerts_email: true,
  system_alerts_browser: false,
  system_alerts_in_app: true,
};

export const defaultSync: SyncSettingsRow = {
  auto_sync: true,
  sync_interval_minutes: 15,
  retry_uploads: true,
};

// ============ Helpers ============
async function userId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

// ============ Service ============
export const settingsService = {
  async getGeneral(): Promise<GeneralSettings> {
    const uid = await userId();
    if (!uid) return defaultGeneral;
    const { data } = await supabase
      .from("user_settings_general")
      .select("*")
      .eq("user_id", uid)
      .maybeSingle();
    if (!data) return defaultGeneral;
    return {
      theme: (data.theme as GeneralSettings["theme"]) ?? "dark",
      compact_mode: data.compact_mode,
      landing_page: data.landing_page,
      default_fps: data.default_fps,
      default_scenes: data.default_scenes,
      default_steps: data.default_steps,
      manual_approval: data.manual_approval,
      auto_publish: data.auto_publish,
      retry_failed: data.retry_failed,
      store_history: data.store_history,
      retain_rejected: data.retain_rejected,
    };
  },

  async saveGeneral(values: GeneralSettings): Promise<void> {
    const uid = await userId();
    if (!uid) throw new Error("Not authenticated");
    const { error } = await supabase
      .from("user_settings_general")
      .upsert({ user_id: uid, ...values });
    if (error) throw error;
  },

  async getPublishing(): Promise<PublishingDefaultsRow> {
    const uid = await userId();
    if (!uid) return defaultPublishing;
    const { data } = await supabase
      .from("publishing_defaults")
      .select("*")
      .eq("user_id", uid)
      .maybeSingle();
    if (!data) return defaultPublishing;
    return {
      default_visibility:
        (data.default_visibility as PublishingDefaultsRow["default_visibility"]) ??
        "subscribers",
      default_category: data.default_category,
      default_price: Number(data.default_price ?? 0),
      watermark_enabled: data.watermark_enabled,
      auto_publish: data.auto_publish,
    };
  },

  async savePublishing(values: PublishingDefaultsRow): Promise<void> {
    const uid = await userId();
    if (!uid) throw new Error("Not authenticated");
    const { error } = await supabase
      .from("publishing_defaults")
      .upsert({ user_id: uid, ...values });
    if (error) throw error;
  },

  async getNotifications(): Promise<NotificationSettingsRow> {
    const uid = await userId();
    if (!uid) return defaultNotifications;
    const { data } = await supabase
      .from("notification_settings")
      .select("*")
      .eq("user_id", uid)
      .maybeSingle();
    if (!data) return defaultNotifications;
    const { user_id: _u, created_at: _c, updated_at: _ud, ...rest } = data;
    return { ...defaultNotifications, ...rest };
  },

  async saveNotifications(values: NotificationSettingsRow): Promise<void> {
    const uid = await userId();
    if (!uid) throw new Error("Not authenticated");
    const { error } = await supabase
      .from("notification_settings")
      .upsert({ user_id: uid, ...values });
    if (error) throw error;
  },

  async getSync(): Promise<SyncSettingsRow> {
    const uid = await userId();
    if (!uid) return defaultSync;
    const { data } = await supabase
      .from("sync_settings")
      .select("*")
      .eq("user_id", uid)
      .maybeSingle();
    if (!data) return defaultSync;
    return {
      auto_sync: data.auto_sync,
      sync_interval_minutes: data.sync_interval_minutes,
      retry_uploads: data.retry_uploads,
    };
  },

  async saveSync(values: SyncSettingsRow): Promise<void> {
    const uid = await userId();
    if (!uid) throw new Error("Not authenticated");
    const { error } = await supabase
      .from("sync_settings")
      .upsert({ user_id: uid, ...values });
    if (error) throw error;
  },
};
