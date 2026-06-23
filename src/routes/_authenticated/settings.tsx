import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Settings as SettingsIcon,
  Palette,
  Sparkles,
  Send,
  Database,
  Plug,
  Bell,
  Server,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Activity,
  CircleDashed,
  Mail,
  MonitorSmartphone,
  Inbox,
} from "lucide-react";
import { toast } from "sonner";

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { AppHeader } from "@/components/dashboard/app-header";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Lila Studio" },
      {
        name: "description",
        content:
          "Configure appearance, generation defaults, Fanvue integration, notifications, and system status.",
      },
    ],
  }),
  component: SettingsPage,
});

// ---------------- Typed structures (future Supabase models) ----------------

export type PublishingPlatform = "fanvue";
export type ConnectionStatus =
  | "connected"
  | "disconnected"
  | "error"
  | "pending";

export interface ConnectedAccount {
  id: string;
  accountName: string;
  platform: PublishingPlatform;
  status: ConnectionStatus;
  lastSyncAt: string | null;
  externalAccountId: string | null;
}

export interface PublishingDefaults {
  defaultVisibility: "public" | "subscribers" | "premium";
  defaultCategory: string;
  defaultPrice: number;
  watermarkEnabled: boolean;
  autoPublish: boolean;
}

export interface NotificationChannel {
  email: boolean;
  browser: boolean;
  inApp: boolean;
}

export interface NotificationSettings {
  generation: NotificationChannel;
  publishing: NotificationChannel;
  failedUpload: NotificationChannel;
  systemAlerts: NotificationChannel;
}

export interface SyncActivity {
  id: string;
  accountId: string;
  startedAt: string;
  finishedAt: string | null;
  status: "success" | "failed" | "running";
  itemsSynced: number;
}

// ---------------- Placeholder service ----------------

export const fanvueServicePlaceholder = {
  async connectAccount(_input: {
    accountName: string;
  }): Promise<ConnectedAccount | null> {
    return null;
  },
  async disconnectAccount(_id: string): Promise<void> {
    return;
  },
  async verifyConnection(_id: string): Promise<{ ok: boolean }> {
    return { ok: false };
  },
  async reconnectAccount(_id: string): Promise<ConnectedAccount | null> {
    return null;
  },
  async testConnection(_id: string): Promise<{ ok: boolean }> {
    return { ok: false };
  },
  async syncAccount(_id: string): Promise<SyncActivity | null> {
    return null;
  },
  async publishContent(_input: {
    accountId: string;
    contentId: string;
  }): Promise<{ ok: boolean; externalPostId?: string }> {
    return { ok: false };
  },
  async retryPublication(_publicationId: string): Promise<{ ok: boolean }> {
    return { ok: false };
  },
};

// ---------------- Component ----------------

function SettingsPage() {
  // General — Appearance
  const [theme, setTheme] = useState<"dark" | "light" | "system">("dark");
  const [compactMode, setCompactMode] = useState(false);
  const [landingPage, setLandingPage] = useState("/");

  // General — Generation
  const [defaultFps, setDefaultFps] = useState(16);
  const [defaultScenes, setDefaultScenes] = useState(10);
  const [defaultSteps, setDefaultSteps] = useState(29);

  // General — Publishing
  const [manualApproval, setManualApproval] = useState(true);
  const [autoPublish, setAutoPublish] = useState(false);
  const [retryFailed, setRetryFailed] = useState(true);

  // General — Storage
  const [storeHistory, setStoreHistory] = useState(true);
  const [retainRejected, setRetainRejected] = useState(false);

  // Fanvue Integration
  const [accounts] = useState<ConnectedAccount[]>([]);
  const [publishingDefaults, setPublishingDefaults] =
    useState<PublishingDefaults>({
      defaultVisibility: "subscribers",
      defaultCategory: "lifestyle",
      defaultPrice: 0,
      watermarkEnabled: true,
      autoPublish: false,
    });
  const [autoSync, setAutoSync] = useState(true);
  const [syncInterval, setSyncInterval] = useState("15");
  const [retryUploads, setRetryUploads] = useState(true);
  const [syncActivity] = useState<SyncActivity[]>([]);

  // Notifications
  const [notifications, setNotifications] = useState<NotificationSettings>({
    generation: { email: false, browser: true, inApp: true },
    publishing: { email: true, browser: true, inApp: true },
    failedUpload: { email: true, browser: true, inApp: true },
    systemAlerts: { email: true, browser: false, inApp: true },
  });

  const updateChannel = (
    key: keyof NotificationSettings,
    channel: keyof NotificationChannel,
    value: boolean,
  ) =>
    setNotifications((prev) => ({
      ...prev,
      [key]: { ...prev[key], [channel]: value },
    }));

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        <main className="flex-1 space-y-8 p-6 lg:p-10">
          {/* Header */}
          <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <SettingsIcon className="h-3.5 w-3.5" />
                Workspace Settings
              </div>
              <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight lg:text-4xl">
                Settings
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Configure platform defaults, manage integrations, and review
                system health. Changes are stored locally until backend services
                are connected.
              </p>
            </div>
            <Badge
              variant="outline"
              className="w-fit border-border/60 bg-muted/40 text-[11px] uppercase tracking-[0.18em] text-muted-foreground"
            >
              Pre-production shell
            </Badge>
          </header>

          <Tabs defaultValue="general" className="space-y-6">
            <TabsList className="grid w-full max-w-2xl grid-cols-4">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="fanvue">Fanvue</TabsTrigger>
              <TabsTrigger value="notifications">Notifications</TabsTrigger>
              <TabsTrigger value="system">System</TabsTrigger>
            </TabsList>

            {/* ---------- GENERAL ---------- */}
            <TabsContent value="general" className="space-y-6">
              <SectionCard
                title="Appearance"
                description="Visual preferences for the operator console."
                icon={Palette}
              >
                <div className="grid gap-6 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Theme</Label>
                    <Select
                      value={theme}
                      onValueChange={(v) => setTheme(v as typeof theme)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="dark">Dark</SelectItem>
                        <SelectItem value="light">Light</SelectItem>
                        <SelectItem value="system">System</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Default landing page</Label>
                    <Select value={landingPage} onValueChange={setLandingPage}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="/">Dashboard</SelectItem>
                        <SelectItem value="/generate">
                          Content Generation
                        </SelectItem>
                        <SelectItem value="/library">Content Library</SelectItem>
                        <SelectItem value="/review">Review Queue</SelectItem>
                        <SelectItem value="/schedule">Scheduling</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <ToggleRow
                    label="Compact mode"
                    description="Denser tables and cards."
                    checked={compactMode}
                    onChange={setCompactMode}
                  />
                </div>
              </SectionCard>

              <SectionCard
                title="Generation Preferences"
                description="Defaults applied when starting a new generation job."
                icon={Sparkles}
              >
                <div className="grid gap-6 md:grid-cols-3">
                  <NumberField
                    label="Default FPS"
                    value={defaultFps}
                    onChange={setDefaultFps}
                  />
                  <NumberField
                    label="Default scene count"
                    value={defaultScenes}
                    onChange={setDefaultScenes}
                  />
                  <NumberField
                    label="Default sampling steps"
                    value={defaultSteps}
                    onChange={setDefaultSteps}
                  />
                </div>
              </SectionCard>

              <SectionCard
                title="Publishing Preferences"
                description="Govern how approved content flows to publishing."
                icon={Send}
              >
                <div className="grid gap-4 md:grid-cols-3">
                  <ToggleRow
                    label="Manual approval required"
                    description="Block auto-publish until a human approves."
                    checked={manualApproval}
                    onChange={setManualApproval}
                  />
                  <ToggleRow
                    label="Auto publish enabled"
                    description="Publish scheduled items automatically."
                    checked={autoPublish}
                    onChange={setAutoPublish}
                  />
                  <ToggleRow
                    label="Retry failed publishing"
                    description="Re-attempt failed publications."
                    checked={retryFailed}
                    onChange={setRetryFailed}
                  />
                </div>
              </SectionCard>

              <SectionCard
                title="Storage Preferences"
                description="Control how long generated content is retained."
                icon={Database}
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <ToggleRow
                    label="Store generation history"
                    description="Persist all generation jobs and metadata."
                    checked={storeHistory}
                    onChange={setStoreHistory}
                  />
                  <ToggleRow
                    label="Retain rejected content"
                    description="Keep rejected items for audit and re-review."
                    checked={retainRejected}
                    onChange={setRetainRejected}
                  />
                </div>
              </SectionCard>

              <div className="flex justify-end">
                <Button onClick={() => toast.success("General settings saved")}>
                  Save changes
                </Button>
              </div>
            </TabsContent>

            {/* ---------- FANVUE ---------- */}
            <TabsContent value="fanvue" className="space-y-6">
              <SectionCard
                title="Connected Accounts"
                description="Manage Fanvue accounts used for publishing."
                icon={Plug}
              >
                {accounts.length === 0 ? (
                  <EmptyState
                    icon={Plug}
                    title="No Fanvue account connected yet."
                    description="Connect a Fanvue account to enable automated publishing."
                    action={
                      <Button
                        onClick={() =>
                          toast.info(
                            "Fanvue integration will be available after backend setup.",
                          )
                        }
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Connect Fanvue Account
                      </Button>
                    }
                  />
                ) : (
                  <div className="space-y-3">
                    {accounts.map((a) => (
                      <AccountRow key={a.id} account={a} />
                    ))}
                  </div>
                )}
              </SectionCard>

              <SectionCard
                title="Publishing Defaults"
                description="Default values applied to new Fanvue posts."
                icon={Send}
              >
                <div className="grid gap-6 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Default visibility</Label>
                    <Select
                      value={publishingDefaults.defaultVisibility}
                      onValueChange={(v) =>
                        setPublishingDefaults((p) => ({
                          ...p,
                          defaultVisibility:
                            v as PublishingDefaults["defaultVisibility"],
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="public">Public</SelectItem>
                        <SelectItem value="subscribers">Subscribers</SelectItem>
                        <SelectItem value="premium">Premium</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Default category</Label>
                    <Input
                      value={publishingDefaults.defaultCategory}
                      onChange={(e) =>
                        setPublishingDefaults((p) => ({
                          ...p,
                          defaultCategory: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Default price (USD)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={publishingDefaults.defaultPrice}
                      onChange={(e) =>
                        setPublishingDefaults((p) => ({
                          ...p,
                          defaultPrice: Number(e.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                  <ToggleRow
                    label="Watermark enabled"
                    description="Apply Lila Studio watermark to outgoing posts."
                    checked={publishingDefaults.watermarkEnabled}
                    onChange={(v) =>
                      setPublishingDefaults((p) => ({
                        ...p,
                        watermarkEnabled: v,
                      }))
                    }
                  />
                  <ToggleRow
                    label="Auto publish"
                    description="Push scheduled posts without confirmation."
                    checked={publishingDefaults.autoPublish}
                    onChange={(v) =>
                      setPublishingDefaults((p) => ({ ...p, autoPublish: v }))
                    }
                  />
                </div>
              </SectionCard>

              <SectionCard
                title="Sync Settings"
                description="Control how the workspace syncs with Fanvue."
                icon={RefreshCcw}
              >
                <div className="grid gap-6 md:grid-cols-3">
                  <ToggleRow
                    label="Auto sync enabled"
                    checked={autoSync}
                    onChange={setAutoSync}
                  />
                  <div className="space-y-2">
                    <Label>Sync interval (minutes)</Label>
                    <Select value={syncInterval} onValueChange={setSyncInterval}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5 minutes</SelectItem>
                        <SelectItem value="15">15 minutes</SelectItem>
                        <SelectItem value="30">30 minutes</SelectItem>
                        <SelectItem value="60">60 minutes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <ToggleRow
                    label="Retry failed uploads"
                    checked={retryUploads}
                    onChange={setRetryUploads}
                  />
                </div>

                <Separator className="my-6" />

                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Last successful sync
                  </Label>
                  {syncActivity.length === 0 ? (
                    <EmptyState
                      icon={Activity}
                      title="No synchronization activity yet."
                      description="Sync history will appear once Fanvue is connected."
                      compact
                    />
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      {syncActivity[0].finishedAt ?? "—"}
                    </div>
                  )}
                </div>
              </SectionCard>
            </TabsContent>

            {/* ---------- NOTIFICATIONS ---------- */}
            <TabsContent value="notifications" className="space-y-6">
              <SectionCard
                title="Notification Preferences"
                description="Choose how each event type reaches you."
                icon={Bell}
              >
                <div className="overflow-hidden rounded-lg border border-border/60">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">
                          Event
                        </th>
                        <th className="px-4 py-3 text-center font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            <Mail className="h-3.5 w-3.5" /> Email
                          </span>
                        </th>
                        <th className="px-4 py-3 text-center font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            <MonitorSmartphone className="h-3.5 w-3.5" /> Browser
                          </span>
                        </th>
                        <th className="px-4 py-3 text-center font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            <Inbox className="h-3.5 w-3.5" /> In-app
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {(
                        [
                          ["generation", "Generation notifications"],
                          ["publishing", "Publishing notifications"],
                          ["failedUpload", "Failed upload notifications"],
                          ["systemAlerts", "System alerts"],
                        ] as const
                      ).map(([key, label]) => (
                        <tr key={key}>
                          <td className="px-4 py-3 font-medium">{label}</td>
                          {(["email", "browser", "inApp"] as const).map((ch) => (
                            <td key={ch} className="px-4 py-3 text-center">
                              <div className="flex justify-center">
                                <Switch
                                  checked={notifications[key][ch]}
                                  onCheckedChange={(v) =>
                                    updateChannel(key, ch, v)
                                  }
                                />
                              </div>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>

              <div className="flex justify-end">
                <Button
                  onClick={() => toast.success("Notification preferences saved")}
                >
                  Save changes
                </Button>
              </div>
            </TabsContent>

            {/* ---------- SYSTEM ---------- */}
            <TabsContent value="system" className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <StatusCard
                  title="Application"
                  status="ok"
                  label="v0.1.0 — pre-production"
                  icon={Server}
                />
                <StatusCard
                  title="Backend (Supabase)"
                  status="pending"
                  label="Not Connected"
                  icon={Database}
                />
                <StatusCard
                  title="RunPod"
                  status="pending"
                  label="Not Configured"
                  icon={Sparkles}
                />
                <StatusCard
                  title="Fanvue"
                  status="pending"
                  label="Awaiting Setup"
                  icon={Plug}
                />
                <StatusCard
                  title="Storage"
                  status="pending"
                  label="Awaiting Setup"
                  icon={Database}
                />
              </div>

              <SectionCard
                title="Diagnostics"
                description="Service connectivity checks. Will activate once integrations are configured."
                icon={ShieldCheck}
              >
                <div className="flex flex-wrap gap-3">
                  <Button variant="outline" disabled>
                    <Activity className="mr-2 h-4 w-4" />
                    Run health check
                  </Button>
                  <Button variant="outline" disabled>
                    <RefreshCcw className="mr-2 h-4 w-4" />
                    Refresh service status
                  </Button>
                </div>
              </SectionCard>
            </TabsContent>
          </Tabs>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

// ---------------- Sub components ----------------

function SectionCard({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description?: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-border/60 bg-card/60">
      <CardContent className="p-6">
        <div className="mb-5 flex items-start gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-primary/25 to-primary/0 text-primary">
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold tracking-tight">
              {title}
            </h2>
            {description && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-muted/20 p-4">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact,
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/10 text-center ${
        compact ? "p-6" : "p-10"
      }`}
    >
      <div className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-muted/40 text-muted-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function AccountRow({ account }: { account: ConnectedAccount }) {
  return (
    <Card className="border-border/60 bg-card/60">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <p className="text-sm font-medium">{account.accountName}</p>
          <p className="text-xs text-muted-foreground">
            {account.platform} · {account.externalAccountId ?? "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{account.status}</Badge>
          <Button size="sm" variant="outline">
            Verify
          </Button>
          <Button size="sm" variant="outline">
            Reconnect
          </Button>
          <Button size="sm" variant="ghost">
            Disconnect
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusCard({
  title,
  label,
  status,
  icon: Icon,
}: {
  title: string;
  label: string;
  status: "ok" | "pending" | "error";
  icon: React.ElementType;
}) {
  const tone =
    status === "ok"
      ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
      : status === "error"
        ? "text-red-400 border-red-500/30 bg-red-500/10"
        : "text-muted-foreground border-border/60 bg-muted/30";
  return (
    <Card className="border-border/60 bg-card/60">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            <Icon className="h-3.5 w-3.5" />
            {title}
          </div>
          <CircleDashed className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Badge variant="outline" className={tone}>
            {label}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
