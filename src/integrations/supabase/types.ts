-- Run this in the SQL Editor of your EXTERNAL Supabase project.
--
-- Creates the core content tables your app expects (per
-- src/integrations/supabase/types.ts): characters, connected_accounts,
-- generation_jobs, images, intensity_presets, prompt_templates,
-- review_queue, scene_templates, schedules, videos, profiles.
--
-- Assumes 001_settings_schema.sql (or equivalent) already ran and created:
--   public.touch_updated_at(), public.app_role, public.user_roles,
--   public.has_role()
-- If you haven't run that yet, run it first — this script depends on it.
--
-- Idempotent — safe to re-run.

-- 1) Enums -------------------------------------------------------------------

do $$ begin
  create type public.connection_status as enum ('connected', 'disconnected', 'error', 'pending');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.publishing_platform as enum ('fanvue');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.job_status as enum ('queued', 'processing', 'completed', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.job_type as enum ('image', 'video');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.publish_status as enum ('draft', 'pending_review', 'approved', 'scheduled', 'published', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.content_status as enum ('pending', 'approved', 'rejected', 'draft', 'pending_review', 'scheduled', 'published', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.content_type as enum ('image', 'video');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.schedule_status as enum ('scheduled', 'published', 'failed', 'cancelled');
exception when duplicate_object then null; end $$;

-- 2) profiles ------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

do $$ begin
  create policy "profiles self read/write" on public.profiles
    for all to authenticated
    using (auth.uid() = id)
    with check (auth.uid() = id);
exception when duplicate_object then null; end $$;

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- 3) characters ------------------------------------------------------------

create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  biography text,
  brand_hashtags text[] not null default '{}',
  personality_traits text[] not null default '{}',
  persona jsonb not null default '{}'::jsonb,
  memory jsonb not null default '{}'::jsonb,
  consistency jsonb not null default '{}'::jsonb,
  generation_defaults jsonb not null default '{}'::jsonb,
  reference_image_url text,
  reference_images text[] not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.characters to authenticated;
grant all on public.characters to service_role;
alter table public.characters enable row level security;

do $$ begin
  create policy "characters admin only" on public.characters
    for all to authenticated
    using (public.has_role(auth.uid(), 'admin'))
    with check (public.has_role(auth.uid(), 'admin'));
exception when duplicate_object then null; end $$;

drop trigger if exists trg_characters_updated on public.characters;
create trigger trg_characters_updated
  before update on public.characters
  for each row execute function public.touch_updated_at();

-- 4) connected_accounts ------------------------------------------------------

create table if not exists public.connected_accounts (
  id uuid primary key default gen_random_uuid(),
  platform public.publishing_platform not null,
  account_name text not null,
  external_account_id text not null,
  access_token text,
  connection_status public.connection_status not null default 'pending',
  last_sync_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.connected_accounts to authenticated;
grant all on public.connected_accounts to service_role;
alter table public.connected_accounts enable row level security;

do $$ begin
  create policy "connected_accounts admin only" on public.connected_accounts
    for all to authenticated
    using (public.has_role(auth.uid(), 'admin'))
    with check (public.has_role(auth.uid(), 'admin'));
exception when duplicate_object then null; end $$;

drop trigger if exists trg_connected_accounts_updated on public.connected_accounts;
create trigger trg_connected_accounts_updated
  before update on public.connected_accounts
  for each row execute function public.touch_updated_at();

-- 5) generation_jobs ---------------------------------------------------------

create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  character_id uuid references public.characters(id) on delete set null,
  type public.job_type not null,
  status public.job_status not null default 'queued',
  input_payload jsonb not null default '{}'::jsonb,
  output_url text,
  error_message text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.generation_jobs to authenticated;
grant all on public.generation_jobs to service_role;
alter table public.generation_jobs enable row level security;

do $$ begin
  create policy "generation_jobs admin only" on public.generation_jobs
    for all to authenticated
    using (public.has_role(auth.uid(), 'admin'))
    with check (public.has_role(auth.uid(), 'admin'));
exception when duplicate_object then null; end $$;

drop trigger if exists trg_generation_jobs_updated on public.generation_jobs;
create trigger trg_generation_jobs_updated
  before update on public.generation_jobs
  for each row execute function public.touch_updated_at();

-- 6) images -------------------------------------------------------------------

create table if not exists public.images (
  id uuid primary key default gen_random_uuid(),
  character_id uuid references public.characters(id) on delete set null,
  connected_account_id uuid references public.connected_accounts(id) on delete set null,
  image_url text not null,
  prompt text,
  status public.content_status not null default 'pending',
  publish_status public.publish_status not null default 'draft',
  published_at timestamptz,
  external_post_id text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.images to authenticated;
grant all on public.images to service_role;
alter table public.images enable row level security;

do $$ begin
  create policy "images admin only" on public.images
    for all to authenticated
    using (public.has_role(auth.uid(), 'admin'))
    with check (public.has_role(auth.uid(), 'admin'));
exception when duplicate_object then null; end $$;

drop trigger if exists trg_images_updated on public.images;
create trigger trg_images_updated
  before update on public.images
  for each row execute function public.touch_updated_at();

-- 7) videos -------------------------------------------------------------------

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  character_id uuid references public.characters(id) on delete set null,
  connected_account_id uuid references public.connected_accounts(id) on delete set null,
  video_url text not null,
  prompt text,
  scene_prompts jsonb not null default '[]'::jsonb,
  status public.content_status not null default 'pending',
  publish_status public.publish_status not null default 'draft',
  published_at timestamptz,
  external_post_id text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.videos to authenticated;
grant all on public.videos to service_role;
alter table public.videos enable row level security;

do $$ begin
  create policy "videos admin only" on public.videos
    for all to authenticated
    using (public.has_role(auth.uid(), 'admin'))
    with check (public.has_role(auth.uid(), 'admin'));
exception when duplicate_object then null; end $$;

drop trigger if exists trg_videos_updated on public.videos;
create trigger trg_videos_updated
  before update on public.videos
  for each row execute function public.touch_updated_at();

-- 8) intensity_presets --------------------------------------------------------

create table if not exists public.intensity_presets (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  key text not null,
  label text not null,
  description text,
  prompt_style text,
  negative_prompt text,
  caption_style text,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.intensity_presets to authenticated;
grant all on public.intensity_presets to service_role;
alter table public.intensity_presets enable row level security;

do $$ begin
  create policy "intensity_presets admin only" on public.intensity_presets
    for all to authenticated
    using (public.has_role(auth.uid(), 'admin'))
    with check (public.has_role(auth.uid(), 'admin'));
exception when duplicate_object then null; end $$;

drop trigger if exists trg_intensity_presets_updated on public.intensity_presets;
create trigger trg_intensity_presets_updated
  before update on public.intensity_presets
  for each row execute function public.touch_updated_at();

-- 9) prompt_templates ----------------------------------------------------------

create table if not exists public.prompt_templates (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  name text not null,
  description text,
  category text,
  intensity text,
  prompt text not null default '',
  caption_direction text,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.prompt_templates to authenticated;
grant all on public.prompt_templates to service_role;
alter table public.prompt_templates enable row level security;

do $$ begin
  create policy "prompt_templates admin only" on public.prompt_templates
    for all to authenticated
    using (public.has_role(auth.uid(), 'admin'))
    with check (public.has_role(auth.uid(), 'admin'));
exception when duplicate_object then null; end $$;

drop trigger if exists trg_prompt_templates_updated on public.prompt_templates;
create trigger trg_prompt_templates_updated
  before update on public.prompt_templates
  for each row execute function public.touch_updated_at();

-- 10) scene_templates -----------------------------------------------------------

create table if not exists public.scene_templates (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  label text not null,
  category text not null,
  intensity text not null default '',
  description text,
  prompt text not null default '',
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.scene_templates to authenticated;
grant all on public.scene_templates to service_role;
alter table public.scene_templates enable row level security;

do $$ begin
  create policy "scene_templates admin only" on public.scene_templates
    for all to authenticated
    using (public.has_role(auth.uid(), 'admin'))
    with check (public.has_role(auth.uid(), 'admin'));
exception when duplicate_object then null; end $$;

drop trigger if exists trg_scene_templates_updated on public.scene_templates;
create trigger trg_scene_templates_updated
  before update on public.scene_templates
  for each row execute function public.touch_updated_at();

-- 11) review_queue ---------------------------------------------------------------

create table if not exists public.review_queue (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null,
  content_type public.content_type not null,
  status public.content_status not null default 'pending',
  reviewer_id uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.review_queue to authenticated;
grant all on public.review_queue to service_role;
alter table public.review_queue enable row level security;

do $$ begin
  create policy "review_queue admin only" on public.review_queue
    for all to authenticated
    using (public.has_role(auth.uid(), 'admin'))
    with check (public.has_role(auth.uid(), 'admin'));
exception when duplicate_object then null; end $$;

drop trigger if exists trg_review_queue_updated on public.review_queue;
create trigger trg_review_queue_updated
  before update on public.review_queue
  for each row execute function public.touch_updated_at();

-- 12) schedules -------------------------------------------------------------------

create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null,
  content_type public.content_type not null,
  platform text not null default '',
  publish_time timestamptz not null,
  status public.schedule_status not null default 'scheduled',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.schedules to authenticated;
grant all on public.schedules to service_role;
alter table public.schedules enable row level security;

do $$ begin
  create policy "schedules admin only" on public.schedules
    for all to authenticated
    using (public.has_role(auth.uid(), 'admin'))
    with check (public.has_role(auth.uid(), 'admin'));
exception when duplicate_object then null; end $$;

drop trigger if exists trg_schedules_updated on public.schedules;
create trigger trg_schedules_updated
  before update on public.schedules
  for each row execute function public.touch_updated_at();

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';
