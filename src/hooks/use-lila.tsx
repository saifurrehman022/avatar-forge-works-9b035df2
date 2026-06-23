import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

const LILA_NAME = "Lila";

async function fetchOrSeedLila(userId: string | null) {
  // Try fetch first
  const { data: existing, error: fetchErr } = await supabase
    .from("characters")
    .select("*")
    .eq("name", LILA_NAME)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (existing) return existing;

  if (!userId) return null;

  // Check admin
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!roles) return null;

  const { data: created, error: insertErr } = await supabase
    .from("characters")
    .insert({
      name: LILA_NAME,
      description:
        "Lila is the core AI persona of the studio — warm, cinematic, lifestyle-focused.",
      biography: "",
      personality_traits: ["warm", "candid", "cinematic", "thoughtful"],
      brand_hashtags: [],
      reference_images: [],
      persona: {},
      generation_defaults: {
        fps: 16,
        framesPerScene: 257,
        numScenes: 10,
        samplingSteps: 29,
        negativePrompt:
          "low quality, blurry, distorted face, extra fingers, watermark, text, logo",
      },
      memory: {},
      consistency: {},
      created_by: userId,
    })
    .select()
    .single();
  if (insertErr) throw insertErr;
  return created;
}

export function useLila() {
  const { user, loading } = useAuth();
  return useQuery({
    queryKey: ["character", "lila"],
    queryFn: () => fetchOrSeedLila(user?.id ?? null),
    enabled: !loading,
    staleTime: 60_000,
  });
}
