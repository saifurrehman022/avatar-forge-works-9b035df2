
-- Rename connected_accounts.account_identifier -> external_account_id
ALTER TABLE public.connected_accounts RENAME COLUMN account_identifier TO external_account_id;

-- Extend characters table with persistence for Character Manager
ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS reference_image_url text,
  ADD COLUMN IF NOT EXISTS biography text,
  ADD COLUMN IF NOT EXISTS brand_hashtags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS persona jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS generation_defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS memory jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS consistency jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Scene templates
CREATE TABLE IF NOT EXISTS public.scene_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  category text NOT NULL,
  label text NOT NULL,
  prompt text NOT NULL DEFAULT '',
  intensity text NOT NULL DEFAULT 'weekday',
  enabled boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scene_templates TO authenticated;
GRANT ALL ON public.scene_templates TO service_role;
ALTER TABLE public.scene_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage scene_templates" ON public.scene_templates
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER scene_templates_touch BEFORE UPDATE ON public.scene_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Prompt templates
CREATE TABLE IF NOT EXISTS public.prompt_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  prompt text NOT NULL DEFAULT '',
  caption_direction text,
  category text,
  enabled boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prompt_templates TO authenticated;
GRANT ALL ON public.prompt_templates TO service_role;
ALTER TABLE public.prompt_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage prompt_templates" ON public.prompt_templates
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER prompt_templates_touch BEFORE UPDATE ON public.prompt_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Intensity presets
CREATE TABLE IF NOT EXISTS public.intensity_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  description text,
  prompt_style text,
  caption_style text,
  negative_prompt text,
  enabled boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (character_id, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intensity_presets TO authenticated;
GRANT ALL ON public.intensity_presets TO service_role;
ALTER TABLE public.intensity_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage intensity_presets" ON public.intensity_presets
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER intensity_presets_touch BEFORE UPDATE ON public.intensity_presets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Make sure characters has an updated_at trigger
DROP TRIGGER IF EXISTS characters_touch ON public.characters;
CREATE TRIGGER characters_touch BEFORE UPDATE ON public.characters
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
