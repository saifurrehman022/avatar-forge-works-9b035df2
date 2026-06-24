-- Run this in the SQL Editor of your EXTERNAL Supabase project
-- (the one the app is pinned to in src/integrations/supabase/client.ts).
--
-- It creates the four settings tables the Settings page writes to,
-- along with required helpers (touch_updated_at trigger fn, has_role,
-- app_role enum, user_roles). Each statement is idempotent — safe to
-- re-run.

-- 1) Helpers ----------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$ begin
  create type public.app_role as enum ('admin', 'moderator', 'user');
exception when duplicate_object then null; end $$;

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

do $$ begin
  create policy "user_roles self read"
    on public.user_roles for select to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  );
$$;

-- 2) user_settings_general --------------------------------------------------

create table if not exists public.user_settings_general (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'dark',
  compact_mode boolean not null default false,
  landing_page text not null default '/',
  default_fps integer not null default 16,
  default_scenes integer not null default 10,
  default_steps integer not null default 29,
  manual_approval boolean not null default true,
  auto_publish boolean not null default false,
  retry_failed boolean not null default true,
  store_history boolean not null default true,
  retain_rejected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.user_settings_general to authenticated;
grant all on public.user_settings_general to service_role;
alter table public.user_settings_general enable row level security;

do $$ begin
  create policy "general admin only" on public.user_settings_general
    for all to authenticated
    using (auth.uid() = user_id and public.has_role(auth.uid(), 'admin'))
    with check (auth.uid() = user_id and public.has_role(auth.uid(), 'admin'));
exception when duplicate_object then null; end $$;

drop trigger if exists trg_user_settings_general_updated on public.user_settings_general;
create trigger trg_user_settings_general_updated
  before update on public.user_settings_general
  for each row execute function public.touch_updated_at();

-- 3) publishing_defaults ----------------------------------------------------

create table if not exists public.publishing_defaults (
  user_id uuid primary key references auth.users(id) on delete cascade,
  default_visibility text not null default 'subscribers',
  default_category text not null default 'lifestyle',
  default_price numeric not null default 0,
  watermark_enabled boolean not null default true,
  auto_publish boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.publishing_defaults to authenticated;
grant all on public.publishing_defaults to service_role;
alter table public.publishing_defaults enable row level security;

do $$ begin
  create policy "publishing defaults admin only" on public.publishing_defaults
    for all to authenticated
    using (auth.uid() = user_id and public.has_role(auth.uid(), 'admin'))
    with check (auth.uid() = user_id and public.has_role(auth.uid(), 'admin'));
exception when duplicate_object then null; end $$;

drop trigger if exists trg_publishing_defaults_updated on public.publishing_defaults;
create trigger trg_publishing_defaults_updated
  before update on public.publishing_defaults
  for each row execute function public.touch_updated_at();

-- 4) sync_settings ----------------------------------------------------------

create table if not exists public.sync_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  auto_sync boolean not null default true,
  sync_interval_minutes integer not null default 15,
  retry_uploads boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.sync_settings to authenticated;
grant all on public.sync_settings to service_role;
alter table public.sync_settings enable row level security;

do $$ begin
  create policy "sync settings admin only" on public.sync_settings
    for all to authenticated
    using (auth.uid() = user_id and public.has_role(auth.uid(), 'admin'))
    with check (auth.uid() = user_id and public.has_role(auth.uid(), 'admin'));
exception when duplicate_object then null; end $$;

drop trigger if exists trg_sync_settings_updated on public.sync_settings;
create trigger trg_sync_settings_updated
  before update on public.sync_settings
  for each row execute function public.touch_updated_at();

-- 5) notification_settings --------------------------------------------------

create table if not exists public.notification_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  generation_email boolean not null default false,
  generation_browser boolean not null default true,
  generation_in_app boolean not null default true,
  publishing_email boolean not null default true,
  publishing_browser boolean not null default true,
  publishing_in_app boolean not null default true,
  failed_upload_email boolean not null default true,
  failed_upload_browser boolean not null default true,
  failed_upload_in_app boolean not null default true,
  system_alerts_email boolean not null default true,
  system_alerts_browser boolean not null default false,
  system_alerts_in_app boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.notification_settings to authenticated;
grant all on public.notification_settings to service_role;
alter table public.notification_settings enable row level security;

do $$ begin
  create policy "notifications admin only" on public.notification_settings
    for all to authenticated
    using (auth.uid() = user_id and public.has_role(auth.uid(), 'admin'))
    with check (auth.uid() = user_id and public.has_role(auth.uid(), 'admin'));
exception when duplicate_object then null; end $$;

drop trigger if exists trg_notification_settings_updated on public.notification_settings;
create trigger trg_notification_settings_updated
  before update on public.notification_settings
  for each row execute function public.touch_updated_at();

-- 6) Make sure your admin user has the 'admin' role -------------------------
-- Replace the email if needed.
insert into public.user_roles (user_id, role)
select id, 'admin'::public.app_role
from auth.users
where email = 'admin@lilastudio.ai'
on conflict (user_id, role) do nothing;

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';
