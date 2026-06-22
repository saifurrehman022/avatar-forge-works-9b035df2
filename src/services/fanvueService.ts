export type PublishingPlatform = "fanvue";
export type ConnectionStatus = "connected" | "disconnected" | "syncing" | "error";
export type DefaultVisibility = "public" | "subscribers" | "premium";
export type CurrencyCode = "USD" | "EUR" | "GBP";
export type SyncActivityStatus = "success" | "warning" | "failed" | "running";
export type DeliveryChannel = "email" | "browser" | "inApp";

export interface ConnectedAccount {
  id: string;
  accountName: string;
  platform: PublishingPlatform;
  status: ConnectionStatus;
  lastSyncTime: string | null;
  accountIdentifier: string;
  createdDate: string;
  externalPostCount: number;
}

export interface SyncActivity {
  id: string;
  accountId: string;
  status: SyncActivityStatus;
  message: string;
  occurredAt: string;
  recordsProcessed: number;
}

export interface NotificationSettings {
  generation: Record<DeliveryChannel, boolean>;
  publishing: Record<DeliveryChannel, boolean>;
  failedUploads: Record<DeliveryChannel, boolean>;
  systemAlerts: Record<DeliveryChannel, boolean>;
}

export interface PublishingDefaults {
  defaultVisibility: DefaultVisibility;
  defaultPrice: number;
  currency: CurrencyCode;
  defaultCategory: string;
  watermarkEnabled: boolean;
  autoPublishEnabled: boolean;
}

export interface FanvueServiceResponse<T = unknown> {
  ok: boolean;
  data?: T;
  message: string;
  requestedAt: string;
}

export interface PublishContentPayload {
  contentId: string;
  accountId: string;
  caption?: string;
  visibility?: DefaultVisibility;
  price?: number;
}

const mockDelay = async () => new Promise((resolve) => setTimeout(resolve, 120));

const response = <T>(message: string, data?: T): FanvueServiceResponse<T> => ({
  ok: true,
  data,
  message,
  requestedAt: new Date().toISOString(),
});

export const fanvueService = {
  async connectAccount(accountName: string): Promise<FanvueServiceResponse<ConnectedAccount>> {
    await mockDelay();
    return response("Mock account connected", {
      id: `mock_${Date.now()}`,
      accountName,
      platform: "fanvue",
      status: "connected",
      lastSyncTime: new Date().toISOString(),
      accountIdentifier: `fanvue:${accountName.toLowerCase().replace(/\s+/g, "-")}`,
      createdDate: new Date().toISOString(),
      externalPostCount: 0,
    });
  },

  async disconnectAccount(
    accountId: string,
  ): Promise<FanvueServiceResponse<{ accountId: string }>> {
    await mockDelay();
    return response("Mock account disconnected", { accountId });
  },

  async reconnectAccount(accountId: string): Promise<FanvueServiceResponse<{ accountId: string }>> {
    await mockDelay();
    return response("Mock account reconnected", { accountId });
  },

  async verifyConnection(
    accountId: string,
  ): Promise<FanvueServiceResponse<{ connected: boolean; accountId: string }>> {
    await mockDelay();
    return response("Mock connection verified", { connected: true, accountId });
  },

  async syncAccount(accountId: string): Promise<FanvueServiceResponse<SyncActivity>> {
    await mockDelay();
    return response("Mock sync completed", {
      id: `sync_${Date.now()}`,
      accountId,
      status: "success",
      message: "Pulled latest publishing metadata from mock service.",
      occurredAt: new Date().toISOString(),
      recordsProcessed: 18,
    });
  },

  async testConnection(
    accountId: string,
  ): Promise<FanvueServiceResponse<{ latencyMs: number; accountId: string }>> {
    await mockDelay();
    return response("Mock test connection succeeded", { latencyMs: 84, accountId });
  },

  async publishContent(
    payload: PublishContentPayload,
  ): Promise<FanvueServiceResponse<{ externalPostId: string }>> {
    await mockDelay();
    return response("Mock content published", {
      externalPostId: `fv_post_${payload.contentId}_${Date.now()}`,
    });
  },

  async retryPublication(
    publicationId: string,
  ): Promise<FanvueServiceResponse<{ publicationId: string }>> {
    await mockDelay();
    return response("Mock publication retry queued", { publicationId });
  },
};
