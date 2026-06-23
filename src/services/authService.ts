import { supabaseAuth } from "@/integrations/supabase-external/client";

export const authService = {
  async signIn(email: string, password: string) {
    return supabaseAuth.auth.signInWithPassword({ email, password });
  },

  async signOut() {
    return supabaseAuth.auth.signOut();
  },

  async getUser() {
    const { data, error } = await supabaseAuth.auth.getUser();
    if (error) throw error;
    return data.user;
  },

  async getSession() {
    const { data } = await supabaseAuth.auth.getSession();
    return data.session;
  },

  async isAdmin(): Promise<boolean> {
    const { data: userData } = await supabaseAuth.auth.getUser();
    if (!userData.user) return false;
    const { data, error } = await supabaseAuth
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (error) return false;
    return !!data;
  },

  onAuthStateChange(cb: Parameters<typeof supabaseAuth.auth.onAuthStateChange>[0]) {
    return supabaseAuth.auth.onAuthStateChange(cb);
  },
};
