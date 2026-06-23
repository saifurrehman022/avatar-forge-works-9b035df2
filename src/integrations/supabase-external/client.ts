// External Supabase project used ONLY for authentication.
// App data still lives in Lovable Cloud (see src/integrations/supabase/client.ts).
// Do not import this client for Data API reads/writes against app tables.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ixkzdnowlbjeiwqzfctu.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_b_go-ZVyLa0NLL7BqZFVzg_2hNG7yEd";

function createAuthClient() {
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: typeof window !== "undefined" ? window.localStorage : undefined,
      storageKey: "sb-ixkzdnowlbjeiwqzfctu-auth-token",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

let _client: ReturnType<typeof createAuthClient> | undefined;

export const supabaseAuth = new Proxy({} as ReturnType<typeof createAuthClient>, {
  get(_t, prop, receiver) {
    if (!_client) _client = createAuthClient();
    return Reflect.get(_client, prop, receiver);
  },
});
