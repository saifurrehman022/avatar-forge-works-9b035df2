
-- Fix search_path on touch_updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Restrict EXECUTE on SECURITY DEFINER helpers
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Storage policies: admins only, across all four buckets
CREATE POLICY "Admins read studio buckets"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id IN ('reference-images','generated-images','generated-videos','character-assets')
    AND public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Admins insert studio buckets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('reference-images','generated-images','generated-videos','character-assets')
    AND public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Admins update studio buckets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id IN ('reference-images','generated-images','generated-videos','character-assets')
    AND public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Admins delete studio buckets"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id IN ('reference-images','generated-images','generated-videos','character-assets')
    AND public.has_role(auth.uid(), 'admin')
  );
