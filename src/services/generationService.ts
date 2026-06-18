import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type GenerationJobInsert = TablesInsert<"generation_jobs">;
export type GenerationJobUpdate = TablesUpdate<"generation_jobs">;
export type JobType = "image" | "video";
export type JobStatus = "queued" | "processing" | "completed" | "failed";

export const generationService = {
  async enqueue(payload: GenerationJobInsert) {
    const { data, error } = await supabase
      .from("generation_jobs")
      .insert({ ...payload, status: payload.status ?? "queued" })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async list(filters?: { status?: JobStatus; type?: JobType }) {
    let q = supabase.from("generation_jobs").select("*").order("created_at", { ascending: false });
    if (filters?.status) q = q.eq("status", filters.status);
    if (filters?.type) q = q.eq("type", filters.type);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  },

  async get(id: string) {
    const { data, error } = await supabase
      .from("generation_jobs").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  },

  async update(id: string, payload: GenerationJobUpdate) {
    const { data, error } = await supabase
      .from("generation_jobs").update(payload).eq("id", id).select().single();
    if (error) throw error;
    return data;
  },

  async markCompleted(id: string, outputUrl: string) {
    return this.update(id, { status: "completed", output_url: outputUrl });
  },

  async markFailed(id: string, errorMessage: string) {
    return this.update(id, { status: "failed", error_message: errorMessage });
  },
};
