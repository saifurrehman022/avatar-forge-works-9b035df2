
ALTER TABLE public.scene_templates ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.prompt_templates ADD COLUMN IF NOT EXISTS intensity text;
