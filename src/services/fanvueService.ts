import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type ConnectedAccountInsert = TablesInsert<"connected_accounts">;
export type ConnectedAccountUpdate = TablesUpdate<"connected_accounts">;

export type PublishingPlatform = "fanvue";
export type ConnectionStatus = "connected" | "disconnected" | "error" | "pending";
export type PublishStatus =
  | "draft"
  | "pending_review"
  | "approved"
  | "scheduled"
  | "published"
  | "failed";

export type ContentKind = "image" | "video";

export interface FanvuePostPayload {
  contentId: string;
  contentKind: ContentKind;
  connectedAccountId: string;
  caption?: string;
  scheduledFor?: string; // ISO timestamp
  mediaUrl: string;
}

export interface FanvuePublishResult {
  ok: boolean;
  externalPostId?: string;
  error?: string;
}

/**
 * fanvueService — mock architecture for Fanvue publishing.
 *
 * Responsibilities:
 *  - Connected account CRUD + connection verification
 *  - Build post payloads from internal content records
 *  - Upload / publish content (mocked)
 *  - Track publish status + external post IDs on the content row
 *  - Sync external post state back into the database
 *  - Surface publishing failures
 *
 * No real Fanvue API calls are made yet. All network operations are stubbed
 * with deterministic mock responses so the rest of the system can be wired
 * end-to-end without a live integration.
 */
export const fanvueService = {
  // ---------- Connected accounts ----------
  async listAccounts(platform: PublishingPlatform = "fanvue") {
    const { data, error } = await supabase
      .from("connected_accounts")
      .select("*")
      .eq("platform", platform)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  },

  async getAccount(id: string) {
    const { data, error } = await supabase
      .from("connected_accounts")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    return data;
  },

  async connectAccount(payload: Omit<ConnectedAccountInsert, "platform"> & { platform?: PublishingPlatform }) {
    const insertPayload: ConnectedAccountInsert = {
      platform: "fanvue",
      ...payload,
      connection_status: "connected",
      last_sync_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from("connected_accounts")
      .insert(insertPayload)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateAccount(id: string, payload: ConnectedAccountUpdate) {
    const { data, error } = await supabase
      .from("connected_accounts")
      .update(payload)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async disconnectAccount(id: string) {
    return this.updateAccount(id, {
      connection_status: "disconnected",
      access_token: null,
    });
  },

  async reconnectAccount(id: string, accessToken?: string) {
    return this.updateAccount(id, {
      connection_status: "connected",
      access_token: accessToken ?? null,
      last_sync_at: new Date().toISOString(),
    });
  },

  /** Mock connection check — replace with a real Fanvue API ping later. */
  async verifyConnection(id: string): Promise<{ connected: boolean; checkedAt: string }> {
    const account = await this.getAccount(id);
    const connected = account.connection_status === "connected" && !!account.access_token;
    const checkedAt = new Date().toISOString();
    await this.updateAccount(id, { last_sync_at: checkedAt });
    return { connected, checkedAt };
  },

  // ---------- Publishing ----------
  buildPostPayload(input: FanvuePostPayload): FanvuePostPayload {
    // Pure helper — formats internal content into a Fanvue-shaped payload.
    return { ...input };
  },

  /** Mock upload — returns a fake external post ID. */
  async uploadContent(payload: FanvuePostPayload): Promise<FanvuePublishResult> {
    const externalPostId = `fv_mock_${payload.contentKind}_${Date.now()}`;
    return { ok: true, externalPostId };
  },

  /**
   * Mark a content row as published (or failed) and persist the external ID.
   * Operates on either `images` or `videos` based on contentKind.
   */
  async recordPublishResult(
    contentKind: ContentKind,
    contentId: string,
    result: FanvuePublishResult,
  ) {
    const table = contentKind === "image" ? "images" : "videos";
    const patch = result.ok
      ? {
          publish_status: "published" as PublishStatus,
          published_at: new Date().toISOString(),
          external_post_id: result.externalPostId ?? null,
        }
      : { publish_status: "failed" as PublishStatus };

    const { data, error } = await supabase
      .from(table)
      .update(patch)
      .eq("id", contentId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /** End-to-end publish flow (mock). */
  async publish(payload: FanvuePostPayload): Promise<FanvuePublishResult> {
    const { connected } = await this.verifyConnection(payload.connectedAccountId);
    if (!connected) {
      const failure: FanvuePublishResult = { ok: false, error: "Account not connected" };
      await this.recordPublishResult(payload.contentKind, payload.contentId, failure);
      return failure;
    }
    const result = await this.uploadContent(this.buildPostPayload(payload));
    await this.recordPublishResult(payload.contentKind, payload.contentId, result);
    return result;
  },

  /** Mock sync — in production this would reconcile with Fanvue's API. */
  async syncExternalPosts(accountId: string) {
    await this.updateAccount(accountId, { last_sync_at: new Date().toISOString() });
    return { synced: 0 };
  },

  async setPublishStatus(
    contentKind: ContentKind,
    contentId: string,
    status: PublishStatus,
  ) {
    const table = contentKind === "image" ? "images" : "videos";
    const { data, error } = await supabase
      .from(table)
      .update({ publish_status: status })
      .eq("id", contentId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};
