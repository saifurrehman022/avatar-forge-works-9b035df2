import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type CharacterInsert = TablesInsert<"characters">;
export type CharacterUpdate = TablesUpdate<"characters">;

export const characterService = {
  async list() {
    const { data, error } = await supabase
      .from("characters")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  },

  async get(id: string) {
    const { data, error } = await supabase
      .from("characters")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async create(payload: CharacterInsert) {
    const { data, error } = await supabase
      .from("characters")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id: string, payload: CharacterUpdate) {
    const { data, error } = await supabase
      .from("characters")
      .update(payload)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async remove(id: string) {
    const { error } = await supabase.from("characters").delete().eq("id", id);
    if (error) throw error;
  },
};
