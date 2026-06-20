
DROP POLICY IF EXISTS "Authenticated users can insert connected accounts" ON public.connected_accounts;
DROP POLICY IF EXISTS "Authenticated users can update connected accounts" ON public.connected_accounts;
DROP POLICY IF EXISTS "Authenticated users can delete connected accounts" ON public.connected_accounts;

CREATE POLICY "Users can insert their own connected accounts"
  ON public.connected_accounts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update their own connected accounts"
  ON public.connected_accounts FOR UPDATE TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can delete their own connected accounts"
  ON public.connected_accounts FOR DELETE TO authenticated
  USING (auth.uid() = created_by);
