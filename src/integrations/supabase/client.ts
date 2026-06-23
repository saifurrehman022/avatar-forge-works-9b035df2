// Pinned to the external Supabase project for Lila Studio.
// Do NOT replace these with env vars — Lovable Cloud regenerates .env
// to point at the Cloud project, which breaks auth.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = 'https://ixkzdnowlbjeiwqzfctu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_b_go-ZVyLa0NLL7BqZFVzg_2hNG7yEd';

function createSupabaseClient() {
  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: typeof window !== 'undefined' ? localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
    }
  });
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";
export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});

