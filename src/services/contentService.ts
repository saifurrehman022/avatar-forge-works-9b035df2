import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type ImageInsert = TablesInsert<"images">;
export type VideoInsert = TablesInsert<"videos">;
export type ImageUpdate = TablesUpdate<"images">;
export type VideoUpdate = TablesUpdate<"videos">;
export type ContentStatus = "pending" | "approved" | "rejected";

const STORAGE_BUCKETS = {
  referenceImages: "reference-images",
  generatedImages: "generated-images",
  generatedVideos: "generated-videos",
  characterAssets: "character-assets",
} as const;

export const contentService = {
  buckets: STORAGE_BUCKETS,

  // ---------- Images ----------
  async listImages(filters?: { characterId?: string; status?: ContentStatus }) {
    let q = supabase.from("images").select("*").order("created_at", { ascending: false });
    if (filters?.characterId) q = q.eq("character_id", filters.characterId);
    if (filters?.status) q = q.eq("status", filters.status);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  },

  async createImage(payload: ImageInsert) {
    const { data, error } = await supabase.from("images").insert(payload).select().single();
    if (error) throw error;
    return data;
  },

  async updateImage(id: string, payload: ImageUpdate) {
    const { data, error } = await supabase
      .from("images").update(payload).eq("id", id).select().single();
    if (error) throw error;
    return data;
  },

  // ---------- Videos ----------
  async listVideos(filters?: { characterId?: string; status?: ContentStatus }) {
    let q = supabase.from("videos").select("*").order("created_at", { ascending: false });
    if (filters?.characterId) q = q.eq("character_id", filters.characterId);
    if (filters?.status) q = q.eq("status", filters.status);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  },

  async createVideo(payload: VideoInsert) {
    const { data, error } = await supabase.from("videos").insert(payload).select().single();
    if (error) throw error;
    return data;
  },

  async updateVideo(id: string, payload: VideoUpdate) {
    const { data, error } = await supabase
      .from("videos").update(payload).eq("id", id).select().single();
    if (error) throw error;
    return data;
  },

  // ---------- Storage ----------
  async uploadFile(bucket: keyof typeof STORAGE_BUCKETS, path: string, file: File) {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKETS[bucket])
      .upload(path, file, { upsert: false });
    if (error) throw error;
    return data;
  },

  async getSignedUrl(bucket: keyof typeof STORAGE_BUCKETS, path: string, expiresIn = 3600) {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKETS[bucket])
      .createSignedUrl(path, expiresIn);
    if (error) throw error;
    return data.signedUrl;
  },
};
