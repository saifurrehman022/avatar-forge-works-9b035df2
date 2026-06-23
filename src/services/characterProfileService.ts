import { supabase } from "@/integrations/supabase/client";

export const LILA_NAME = "Lila Valentina Rossi";

export type PersonaJson = {
  traits: string[];
  writingStyle: string;
  captionTone: string;
  brandVoice: string;
  description: string;
};

export type GenerationDefaultsJson = {
  fps: number;
  framesPerScene: number;
  samplingSteps: number;
  sceneCount: number;
  negativePrompt: string;
};

export type MemoryJson = {
  locations: string;
  themes: string;
  lifestyle: string;
  pet: string;
  brand: string;
};

export type SceneRow = {
  id: string;
  category: string;
  label: string;
  prompt: string;
  intensity: string;
  description: string | null;
  sort_order: number;
};

export type PromptRow = {
  id: string;
  name: string;
  prompt: string;
  caption_direction: string | null;
  intensity: string | null;
  category: string | null;
  sort_order: number;
};

export type IntensityPresetRow = {
  id: string;
  key: string;
  label: string;
  prompt_style: string | null;
  caption_style: string | null;
  negative_prompt: string | null;
  sort_order: number;
};

export type CharacterProfile = {
  id: string;
  name: string;
  biography: string | null;
  reference_image_url: string | null;
  brand_hashtags: string[];
  persona: PersonaJson;
  generation_defaults: GenerationDefaultsJson;
  memory: MemoryJson;
  scenes: SceneRow[];
  prompts: PromptRow[];
  presets: IntensityPresetRow[];
};

export const characterProfileService = {
  async loadLila(): Promise<{ id: string } | null> {
    const { data, error } = await supabase
      .from("characters")
      .select("id")
      .eq("name", LILA_NAME)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async fetchProfile(): Promise<CharacterProfile | null> {
    const { data: char, error } = await supabase
      .from("characters")
      .select("*")
      .eq("name", LILA_NAME)
      .maybeSingle();
    if (error) throw error;
    if (!char) return null;

    const [scenes, prompts, presets] = await Promise.all([
      supabase
        .from("scene_templates")
        .select("*")
        .eq("character_id", char.id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("prompt_templates")
        .select("*")
        .eq("character_id", char.id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("intensity_presets")
        .select("*")
        .eq("character_id", char.id)
        .order("sort_order", { ascending: true }),
    ]);

    return {
      id: char.id,
      name: char.name,
      biography: char.biography ?? null,
      reference_image_url: char.reference_image_url ?? null,
      brand_hashtags: char.brand_hashtags ?? [],
      persona: (char.persona ?? {}) as PersonaJson,
      generation_defaults: (char.generation_defaults ?? {}) as GenerationDefaultsJson,
      memory: (char.memory ?? {}) as MemoryJson,
      scenes: (scenes.data ?? []) as SceneRow[],
      prompts: (prompts.data ?? []) as PromptRow[],
      presets: (presets.data ?? []) as IntensityPresetRow[],
    };
  },

  async createCharacter(input: {
    biography: string;
    reference_image_url: string;
    brand_hashtags: string[];
    persona: PersonaJson;
    generation_defaults: GenerationDefaultsJson;
    memory: MemoryJson;
  }): Promise<string> {
    const { data, error } = await supabase
      .from("characters")
      .insert({
        name: LILA_NAME,
        description: input.biography,
        biography: input.biography,
        reference_image_url: input.reference_image_url,
        brand_hashtags: input.brand_hashtags,
        persona: input.persona as never,
        generation_defaults: input.generation_defaults as never,
        memory: input.memory as never,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  },

  async updateCharacter(
    id: string,
    patch: {
      persona?: PersonaJson;
      generation_defaults?: GenerationDefaultsJson;
      memory?: MemoryJson;
      brand_hashtags?: string[];
      biography?: string;
      reference_image_url?: string;
    },
  ) {
    const update: Record<string, unknown> = {};
    if (patch.persona !== undefined) update.persona = patch.persona;
    if (patch.generation_defaults !== undefined)
      update.generation_defaults = patch.generation_defaults;
    if (patch.memory !== undefined) update.memory = patch.memory;
    if (patch.brand_hashtags !== undefined) update.brand_hashtags = patch.brand_hashtags;
    if (patch.biography !== undefined) update.biography = patch.biography;
    if (patch.reference_image_url !== undefined)
      update.reference_image_url = patch.reference_image_url;

    const { error } = await supabase.from("characters").update(update).eq("id", id);
    if (error) throw error;
  },

  async seedScenes(
    characterId: string,
    scenes: Array<Omit<SceneRow, "id">>,
  ): Promise<SceneRow[]> {
    const { data, error } = await supabase
      .from("scene_templates")
      .insert(
        scenes.map((s) => ({
          character_id: characterId,
          category: s.category,
          label: s.label,
          prompt: s.prompt,
          intensity: s.intensity,
          description: s.description,
          sort_order: s.sort_order,
        })),
      )
      .select("*");
    if (error) throw error;
    return (data ?? []) as SceneRow[];
  },

  async seedPrompts(
    characterId: string,
    prompts: Array<Omit<PromptRow, "id">>,
  ): Promise<PromptRow[]> {
    const { data, error } = await supabase
      .from("prompt_templates")
      .insert(
        prompts.map((p) => ({
          character_id: characterId,
          name: p.name,
          prompt: p.prompt,
          caption_direction: p.caption_direction,
          intensity: p.intensity,
          category: p.category,
          sort_order: p.sort_order,
        })),
      )
      .select("*");
    if (error) throw error;
    return (data ?? []) as PromptRow[];
  },

  async seedPresets(
    characterId: string,
    presets: Array<Omit<IntensityPresetRow, "id">>,
  ): Promise<IntensityPresetRow[]> {
    const { data, error } = await supabase
      .from("intensity_presets")
      .insert(
        presets.map((p) => ({
          character_id: characterId,
          key: p.key,
          label: p.label,
          prompt_style: p.prompt_style,
          caption_style: p.caption_style,
          negative_prompt: p.negative_prompt,
          sort_order: p.sort_order,
        })),
      )
      .select("*");
    if (error) throw error;
    return (data ?? []) as IntensityPresetRow[];
  },
};
