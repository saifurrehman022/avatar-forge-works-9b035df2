import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export const sceneTemplateService = {
  async list(characterId: string) {
    const { data, error } = await supabase
      .from("scene_templates")
      .select("*")
      .eq("character_id", characterId)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return data;
  },
  async create(p: TablesInsert<"scene_templates">) {
    const { data, error } = await supabase.from("scene_templates").insert(p).select().single();
    if (error) throw error;
    return data;
  },
  async update(id: string, p: TablesUpdate<"scene_templates">) {
    const { data, error } = await supabase.from("scene_templates").update(p).eq("id", id).select().single();
    if (error) throw error;
    return data;
  },
  async remove(id: string) {
    const { error } = await supabase.from("scene_templates").delete().eq("id", id);
    if (error) throw error;
  },
};

export const promptTemplateService = {
  async list(characterId: string) {
    const { data, error } = await supabase
      .from("prompt_templates")
      .select("*")
      .eq("character_id", characterId)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return data;
  },
  async create(p: TablesInsert<"prompt_templates">) {
    const { data, error } = await supabase.from("prompt_templates").insert(p).select().single();
    if (error) throw error;
    return data;
  },
  async update(id: string, p: TablesUpdate<"prompt_templates">) {
    const { data, error } = await supabase.from("prompt_templates").update(p).eq("id", id).select().single();
    if (error) throw error;
    return data;
  },
  async remove(id: string) {
    const { error } = await supabase.from("prompt_templates").delete().eq("id", id);
    if (error) throw error;
  },
};

export const intensityPresetService = {
  async list(characterId: string) {
    const { data, error } = await supabase
      .from("intensity_presets")
      .select("*")
      .eq("character_id", characterId)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return data;
  },
  async create(p: TablesInsert<"intensity_presets">) {
    const { data, error } = await supabase.from("intensity_presets").insert(p).select().single();
    if (error) throw error;
    return data;
  },
  async update(id: string, p: TablesUpdate<"intensity_presets">) {
    const { data, error } = await supabase.from("intensity_presets").update(p).eq("id", id).select().single();
    if (error) throw error;
    return data;
  },
};
