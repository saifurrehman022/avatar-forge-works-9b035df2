
-- Extend content_status enum with publishing lifecycle values
ALTER TYPE public.content_status ADD VALUE IF NOT EXISTS 'draft';
ALTER TYPE public.content_status ADD VALUE IF NOT EXISTS 'pending_review';
ALTER TYPE public.content_status ADD VALUE IF NOT EXISTS 'scheduled';
ALTER TYPE public.content_status ADD VALUE IF NOT EXISTS 'published';
ALTER TYPE public.content_status ADD VALUE IF NOT EXISTS 'failed';

-- Platform enum (expandable)
DO $$ BEGIN
  CREATE TYPE public.publishing_platform AS ENUM ('fanvue');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Connection status enum
DO $$ BEGIN
  CREATE TYPE public.connection_status AS ENUM ('connected', 'disconnected', 'error', 'pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Publish status enum (per-content-item)
DO $$ BEGIN
  CREATE TYPE public.publish_status AS ENUM ('draft', 'pending_review', 'approved', 'scheduled', 'published', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- connected_accounts table
CREATE TABLE public.connected_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  platform public.publishing_platform NOT NULL,
  account_name TEXT NOT NULL,
  account_identifier TEXT NOT NULL,
  connection_status public.connection_status NOT NULL DEFAULT 'pending',
  access_token TEXT,
  last_sync_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, account_identifier)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.connected_accounts TO authenticated;
GRANT ALL ON public.connected_accounts TO service_role;

ALTER TABLE public.connected_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view connected accounts"
  ON public.connected_accounts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert connected accounts"
  ON public.connected_accounts FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update connected accounts"
  ON public.connected_accounts FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete connected accounts"
  ON public.connected_accounts FOR DELETE TO authenticated USING (true);

CREATE TRIGGER connected_accounts_updated_at
  BEFORE UPDATE ON public.connected_accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Extend images table with publishing metadata
ALTER TABLE public.images
  ADD COLUMN connected_account_id UUID REFERENCES public.connected_accounts(id) ON DELETE SET NULL,
  ADD COLUMN publish_status public.publish_status NOT NULL DEFAULT 'draft',
  ADD COLUMN published_at TIMESTAMPTZ,
  ADD COLUMN external_post_id TEXT;

-- Extend videos table with publishing metadata
ALTER TABLE public.videos
  ADD COLUMN connected_account_id UUID REFERENCES public.connected_accounts(id) ON DELETE SET NULL,
  ADD COLUMN publish_status public.publish_status NOT NULL DEFAULT 'draft',
  ADD COLUMN published_at TIMESTAMPTZ,
  ADD COLUMN external_post_id TEXT;

CREATE INDEX idx_images_connected_account ON public.images(connected_account_id);
CREATE INDEX idx_videos_connected_account ON public.videos(connected_account_id);
CREATE INDEX idx_images_publish_status ON public.images(publish_status);
CREATE INDEX idx_videos_publish_status ON public.videos(publish_status);
