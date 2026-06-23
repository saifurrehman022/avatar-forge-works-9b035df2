import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type ConnectedAccountInsert = TablesInsert<"connected_accounts">;
export type ConnectedAccountUpdate = TablesUpdate<"connected_accounts">;

export const connectedAccountService = {
  async list() {
    const { data, error } = await supabase
      .from("connected_accounts")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data;
  },
  async create(payload: ConnectedAccountInsert) {
    const { data, error } = await supabase
      .from("connected_accounts")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async update(id: string, payload: ConnectedAccountUpdate) {
    const { data, error } = await supabase
      .from("connected_accounts")
      .update(payload)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async remove(id: string) {
    const { error } = await supabase.from("connected_accounts").delete().eq("id", id);
    if (error) throw error;
  },
};
