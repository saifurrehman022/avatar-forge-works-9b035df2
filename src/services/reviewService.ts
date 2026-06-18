import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";

export type ReviewInsert = TablesInsert<"review_queue">;
export type ReviewContentType = "image" | "video";
export type ReviewStatus = "pending" | "approved" | "rejected";

export const reviewService = {
  async enqueue(contentType: ReviewContentType, contentId: string) {
    const { data, error } = await supabase
      .from("review_queue")
      .insert({ content_type: contentType, content_id: contentId, status: "pending" })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async listPending() {
    const { data, error } = await supabase
      .from("review_queue")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data;
  },

  async decide(id: string, decision: "approved" | "rejected", notes?: string) {
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("review_queue")
      .update({
        status: decision,
        reviewer_id: userData.user?.id ?? null,
        reviewed_at: new Date().toISOString(),
        notes: notes ?? null,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    // Mirror decision on the underlying content row
    if (data) {
      const table = data.content_type === "image" ? "images" : "videos";
      await supabase.from(table).update({ status: decision }).eq("id", data.content_id);
    }
    return data;
  },
};
