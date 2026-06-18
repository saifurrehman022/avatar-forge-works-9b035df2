import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type ScheduleInsert = TablesInsert<"schedules">;
export type ScheduleUpdate = TablesUpdate<"schedules">;
export type ScheduleStatus = "scheduled" | "published" | "failed" | "cancelled";

export const scheduleService = {
  async create(payload: ScheduleInsert) {
    const { data, error } = await supabase
      .from("schedules").insert(payload).select().single();
    if (error) throw error;
    return data;
  },

  async list(filters?: { status?: ScheduleStatus; platform?: string }) {
    let q = supabase.from("schedules").select("*").order("publish_time", { ascending: true });
    if (filters?.status) q = q.eq("status", filters.status);
    if (filters?.platform) q = q.eq("platform", filters.platform);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  },

  async update(id: string, payload: ScheduleUpdate) {
    const { data, error } = await supabase
      .from("schedules").update(payload).eq("id", id).select().single();
    if (error) throw error;
    return data;
  },

  async cancel(id: string) {
    return this.update(id, { status: "cancelled" });
  },
};
