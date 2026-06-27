import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

import { useAuth } from "@/hooks/use-auth";
import { settingsService, connectedAccountService } from "@/services";
import type { Tables } from "@/integrations/supabase/types";

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

type ConnectedAccountRow = Tables<"connected_accounts">;

interface NotificationChannel { email: boolean; browser: boolean; inApp: boolean; }
interface NotificationsState {
  generation: NotificationChannel;
  publishing: NotificationChannel;
  failedUpload: NotificationChannel;
  systemAlerts: NotificationChannel;
}

function SettingsPage() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const queryClient = useQueryClient();

  // ---------- Queries ----------
  const { data: general } = useQuery({
    queryKey: ["settings", "general", userId],
    queryFn: () => settingsService.getGeneral(userId),
    enabled: !!userId,
  });
  const { data: publishingRow } = useQuery({
    queryKey: ["settings", "publishing", userId],
    queryFn: () => settingsService.getPublishingDefaults(userId),
    enabled: !!userId,
  });
  const { data: syncRow } = useQuery({
    queryKey: ["settings", "sync", userId],
    queryFn: () => settingsService.getSync(userId),
    enabled: !!userId,
  });
  const { data: notifRow } = useQuery({
    queryKey: ["settings", "notifications", userId],
    queryFn: () => settingsService.getNotifications(userId),
    enabled: !!userId,
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ["connected-accounts"],
    queryFn: () => connectedAccountService.list(),
  });

  // ---------- General state ----------
  const [theme, setTheme] = useState<"dark" | "light" | "system">("dark");
  const [compactMode, setCompactMode] = useState(false);
  const [landingPage, setLandingPage] = useState("/");
  const [defaultFps, setDefaultFps] = useState(16);
  const [defaultScenes, setDefaultScenes] = useState(10);
  const [defaultSteps, setDefaultSteps] = useState(29);
  const [manualApproval, setManualApproval] = useState(true);
  const [autoPublishG, setAutoPublishG] = useState(false);
  const [retryFailed, setRetryFailed] = useState(true);
  const [storeHistory, setStoreHistory] = useState(true);
  const [retainRejected, setRetainRejected] = useState(false);

  useEffect(() => {
    if (!general) return;
    setTheme((general.theme as any) ?? "dark");
    setCompactMode(general.compact_mode);
    setLandingPage(general.landing_page);
    setDefaultFps(general.default_fps);
    setDefaultScenes(general.default_scenes);
    setDefaultSteps(general.default_steps);
    setManualApproval(general.manual_approval);
    setAutoPublishG(general.auto_publish);
    setRetryFailed(general.retry_failed);
    setStoreHistory(general.store_history);
    setRetainRejected(general.retain_rejected);
  }, [general]);

  const saveGeneral = async () => {
    if (!userId) return;
    try {
      await settingsService.upsertGeneral({
        user_id: userId, theme, compact_mode: compactMode, landing_page: landingPage,
        default_fps: defaultFps, default_scenes: defaultScenes, default_steps: defaultSteps,
        manual_approval: manualApproval, auto_publish: autoPublishG, retry_failed: retryFailed,
        store_history: storeHistory, retain_rejected: retainRejected,
      });
      toast.success("General settings saved");
      queryClient.invalidateQueries({ queryKey: ["settings", "general", userId] });
    } catch (e: any) { toast.error(e?.message ?? "Failed to save"); }
  };

  // ---------- Publishing defaults ----------
  const [pubVisibility, setPubVisibility] = useState<"public" | "subscribers" | "premium">("subscribers");
  const [pubCategory, setPubCategory] = useState("lifestyle");
  const [pubPrice, setPubPrice] = useState(0);
  const [watermarkEnabled, setWatermarkEnabled] = useState(true);
  const [pubAutoPublish, setPubAutoPublish] = useState(false);

  useEffect(() => {
    if (!publishingRow) return;
    setPubVisibility((publishingRow.default_visibility as any) ?? "subscribers");
    setPubCategory(publishingRow.default_category ?? "lifestyle");
    setPubPrice(Number(publishingRow.default_price ?? 0));
    setWatermarkEnabled(publishingRow.watermark_enabled);
    setPubAutoPublish(publishingRow.auto_publish);
  }, [publishingRow]);

  // ---------- Sync ----------
  const [autoSync, setAutoSync] = useState(true);
  const [syncInterval, setSyncInterval] = useState("15");
  const [retryUploads, setRetryUploads] = useState(true);
  useEffect(() => {
    if (!syncRow) return;
    setAutoSync(syncRow.auto_sync);
    setSyncInterval(String(syncRow.sync_interval_minutes));
    setRetryUploads(syncRow.retry_uploads);
  }, [syncRow]);

  const saveFanvue = async () => {
    if (!userId) return;
    try {
      await Promise.all([
        settingsService.upsertPublishingDefaults({
          user_id: userId, default_visibility: pubVisibility, default_category: pubCategory,
          default_price: pubPrice, watermark_enabled: watermarkEnabled, auto_publish: pubAutoPublish,
        }),
        settingsService.upsertSync({
          user_id: userId, auto_sync: autoSync, sync_interval_minutes: Number(syncInterval), retry_uploads: retryUploads,
        }),
      ]);
      toast.success("Fanvue settings saved");
      queryClient.invalidateQueries({ queryKey: ["settings", "publishing", userId] });
      queryClient.invalidateQueries({ queryKey: ["settings", "sync", userId] });
    } catch (e: any) { toast.error(e?.message ?? "Failed to save"); }
  };

  // ---------- Notifications ----------
  const [notifications, setNotifications] = useState<NotificationsState>({
    generation: { email: false, browser: true, inApp: true },
    publishing: { email: true, browser: true, inApp: true },
    failedUpload: { email: true, browser: true, inApp: true },
    systemAlerts: { email: true, browser: false, inApp: true },
  });

  useEffect(() => {
    if (!notifRow) return;
    setNotifications({
      generation: { email: notifRow.generation_email, browser: notifRow.generation_browser, inApp: notifRow.generation_in_app },
      publishing: { email: notifRow.publishing_email, browser: notifRow.publishing_browser, inApp: notifRow.publishing_in_app },
      failedUpload: { email: notifRow.failed_upload_email, browser: notifRow.failed_upload_browser, inApp: notifRow.failed_upload_in_app },
      systemAlerts: { email: notifRow.system_alerts_email, browser: notifRow.system_alerts_browser, inApp: notifRow.system_alerts_in_app },
    });
  }, [notifRow]);

  const updateChannel = (
    key: keyof NotificationsState,
    channel: keyof NotificationChannel,
    value: boolean,
  ) =>
    setNotifications((prev) => ({ ...prev, [key]: { ...prev[key], [channel]: value } }));

  const saveNotifications = async () => {
    if (!userId) return;
    try {
      await settingsService.upsertNotifications({
        user_id: userId,
        generation_email: notifications.generation.email,
        generation_browser: notifications.generation.browser,
        generation_in_app: notifications.generation.inApp,
        publishing_email: notifications.publishing.email,
        publishing_browser: notifications.publishing.browser,
        publishing_in_app: notifications.publishing.inApp,
        failed_upload_email: notifications.failedUpload.email,
        failed_upload_browser: notifications.failedUpload.browser,
        failed_upload_in_app: notifications.failedUpload.inApp,
        system_alerts_email: notifications.systemAlerts.email,
        system_alerts_browser: notifications.systemAlerts.browser,
        system_alerts_in_app: notifications.systemAlerts.inApp,
      });
      toast.success("Notification preferences saved");
      queryClient.invalidateQueries({ queryKey: ["settings", "notifications", userId] });
    } catch (e: any) { toast.error(e?.message ?? "Failed to save"); }
  };

  // ---------- Account actions ----------
  const connectAccount = async () => {
    const name = window.prompt("Fanvue account name (e.g. 'Fanvue Main')");
    if (!name) return;
    const handle = window.prompt("Account handle / external ID (e.g. '@lila.studio')") ?? "";
    try {
      await connectedAccountService.create({
        account_name: name,
        external_account_id: handle || name,
        platform: "fanvue" as any,
        connection_status: "connected" as any,
        created_by: userId || null,
      });
      toast.success("Account connected");
      queryClient.invalidateQueries({ queryKey: ["connected-accounts"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed to connect"); }
  };
  const disconnectAccount = async (id: string) => {
    try {
      await connectedAccountService.remove(id);
      toast.success("Account disconnected");
      queryClient.invalidateQueries({ queryKey: ["connected-accounts"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed to disconnect"); }
  };

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        <main className="flex-1 space-y-8 p-6 lg:p-10">
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
                Configure platform defaults, manage integrations, and review system health.
              </p>
            </div>
            <Badge variant="outline" className="w-fit border-border/60 bg-muted/40 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Live · Supabase-backed
            </Badge>
          </header>

          <Tabs defaultValue="general" className="space-y-6">
            <TabsList className="grid w-full max-w-2xl grid-cols-4">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="fanvue">Fanvue</TabsTrigger>
              <TabsTrigger value="notifications">Notifications</TabsTrigger>
              <TabsTrigger value="system">System</TabsTrigger>
            </TabsList>

            {/* GENERAL */}
            <TabsContent value="general" className="space-y-6">
              <SectionCard title="Appearance" description="Visual preferences for the operator console." icon={Palette}>
                <div className="grid gap-6 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Theme</Label>
                    <Select value={theme} onValueChange={(v) => setTheme(v as typeof theme)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
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
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="/">Dashboard</SelectItem>
                        <SelectItem value="/generate">Content Generation</SelectItem>
                        <SelectItem value="/library">Content Library</SelectItem>
                        <SelectItem value="/review">Review Queue</SelectItem>
                        <SelectItem value="/schedule">Scheduling</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <ToggleRow label="Compact mode" description="Denser tables and cards." checked={compactMode} onChange={setCompactMode} />
                </div>
              </SectionCard>

              <SectionCard title="Generation Preferences" description="Defaults applied when starting a new generation job." icon={Sparkles}>
                <div className="grid gap-6 md:grid-cols-3">
                  <NumberField label="Default FPS" value={defaultFps} onChange={setDefaultFps} />
                  <NumberField label="Default scene count" value={defaultScenes} onChange={setDefaultScenes} />
                  <NumberField label="Default sampling steps" value={defaultSteps} onChange={setDefaultSteps} />
                </div>
              </SectionCard>

              <SectionCard title="Publishing Preferences" description="Govern how approved content flows to publishing." icon={Send}>
                <div className="grid gap-4 md:grid-cols-3">
                  <ToggleRow label="Manual approval required" description="Block auto-publish until a human approves." checked={manualApproval} onChange={setManualApproval} />
                  <ToggleRow label="Auto publish enabled" description="Publish scheduled items automatically." checked={autoPublishG} onChange={setAutoPublishG} />
                  <ToggleRow label="Retry failed publishing" description="Re-attempt failed publications." checked={retryFailed} onChange={setRetryFailed} />
                </div>
              </SectionCard>

              <SectionCard title="Storage Preferences" description="Control how long generated content is retained." icon={Database}>
                <div className="grid gap-4 md:grid-cols-2">
                  <ToggleRow label="Store generation history" description="Persist all generation jobs and metadata." checked={storeHistory} onChange={setStoreHistory} />
                  <ToggleRow label="Retain rejected content" description="Keep rejected items for audit and re-review." checked={retainRejected} onChange={setRetainRejected} />
                </div>
              </SectionCard>

              <div className="flex justify-end">
                <Button onClick={saveGeneral}>Save changes</Button>
              </div>
            </TabsContent>

            {/* FANVUE */}
            <TabsContent value="fanvue" className="space-y-6">
              <SectionCard title="Connected Accounts" description="Manage Fanvue accounts used for publishing." icon={Plug}>
                {accounts.length === 0 ? (
                  <EmptyState
                    icon={Plug}
                    title="No Fanvue account connected yet."
                    description="Connect a Fanvue account to enable automated publishing."
                    action={<Button onClick={connectAccount}><Plus className="mr-2 h-4 w-4" />Connect Fanvue Account</Button>}
                  />
                ) : (
                  <div className="space-y-3">
                    {accounts.map((a) => (
                      <AccountRow key={a.id} account={a} onDisconnect={() => disconnectAccount(a.id)} />
                    ))}
                    <div className="flex justify-end">
                      <Button variant="outline" size="sm" onClick={connectAccount}>
                        <Plus className="mr-2 h-4 w-4" /> Connect another
                      </Button>
                    </div>
                  </div>
                )}
              </SectionCard>

              <SectionCard title="Publishing Defaults" description="Default values applied to new Fanvue posts." icon={Send}>
                <div className="grid gap-6 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Default visibility</Label>
                    <Select value={pubVisibility} onValueChange={(v) => setPubVisibility(v as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="public">Public</SelectItem>
                        <SelectItem value="subscribers">Subscribers</SelectItem>
                        <SelectItem value="premium">Premium</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Default category</Label>
                    <Input value={pubCategory} onChange={(e) => setPubCategory(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Default price (USD)</Label>
                    <Input type="number" min={0} value={pubPrice} onChange={(e) => setPubPrice(Number(e.target.value) || 0)} />
                  </div>
                  <ToggleRow label="Watermark enabled" description="Apply Lila Studio watermark to outgoing posts." checked={watermarkEnabled} onChange={setWatermarkEnabled} />
                  <ToggleRow label="Auto publish" description="Push scheduled posts without confirmation." checked={pubAutoPublish} onChange={setPubAutoPublish} />
                </div>
              </SectionCard>

              <SectionCard title="Sync Settings" description="Control how the workspace syncs with Fanvue." icon={RefreshCcw}>
                <div className="grid gap-6 md:grid-cols-3">
                  <ToggleRow label="Auto sync enabled" checked={autoSync} onChange={setAutoSync} />
                  <div className="space-y-2">
                    <Label>Sync interval (minutes)</Label>
                    <Select value={syncInterval} onValueChange={setSyncInterval}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5 minutes</SelectItem>
                        <SelectItem value="15">15 minutes</SelectItem>
                        <SelectItem value="30">30 minutes</SelectItem>
                        <SelectItem value="60">60 minutes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <ToggleRow label="Retry failed uploads" checked={retryUploads} onChange={setRetryUploads} />
                </div>
              </SectionCard>

              <div className="flex justify-end">
                <Button onClick={saveFanvue}>Save changes</Button>
              </div>
            </TabsContent>

            {/* NOTIFICATIONS */}
            <TabsContent value="notifications" className="space-y-6">
              <SectionCard title="Notification Preferences" description="Choose how each event type reaches you." icon={Bell}>
                <div className="overflow-hidden rounded-lg border border-border/60">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">Event</th>
                        <th className="px-4 py-3 text-center font-medium"><span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Email</span></th>
                        <th className="px-4 py-3 text-center font-medium"><span className="inline-flex items-center gap-1.5"><MonitorSmartphone className="h-3.5 w-3.5" /> Browser</span></th>
                        <th className="px-4 py-3 text-center font-medium"><span className="inline-flex items-center gap-1.5"><Inbox className="h-3.5 w-3.5" /> In-app</span></th>
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
                                <Switch checked={notifications[key][ch]} onCheckedChange={(v) => updateChannel(key, ch, v)} />
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
                <Button onClick={saveNotifications}>Save changes</Button>
              </div>
            </TabsContent>

            {/* SYSTEM */}
            <TabsContent value="system" className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <StatusCard title="Application" status="ok" label="v0.1.0" icon={Server} />
                <StatusCard title="Backend" status="ok" label="Connected" icon={Database} />
                <StatusCard title="RunPod" status="pending" label="Not Configured" icon={Sparkles} />
                <StatusCard
                  title="Fanvue"
                  status={accounts.some((a) => a.connection_status === "connected") ? "ok" : "pending"}
                  label={accounts.some((a) => a.connection_status === "connected") ? "Connected" : "Awaiting Setup"}
                  icon={Plug}
                />
                <StatusCard title="Storage" status="ok" label="Connected" icon={Database} />
              </div>

              <SectionCard title="Diagnostics" description="Service connectivity checks." icon={ShieldCheck}>
                <div className="flex flex-wrap gap-3">
                  <Button variant="outline" disabled><Activity className="mr-2 h-4 w-4" />Run health check</Button>
                  <Button variant="outline" disabled><RefreshCcw className="mr-2 h-4 w-4" />Refresh service status</Button>
                </div>
              </SectionCard>
            </TabsContent>
          </Tabs>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function SectionCard({
  title, description, icon: Icon, children,
}: { title: string; description?: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <Card className="border-border/60 bg-card/60">
      <CardContent className="p-6">
        <div className="mb-5 flex items-start gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-primary/25 to-primary/0 text-primary">
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold tracking-tight">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function ToggleRow({
  label, description, checked, onChange,
}: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-muted/20 p-4">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function NumberField({
  label, value, onChange,
}: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type="number" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </div>
  );
}

function EmptyState({
  icon: Icon, title, description, action,
}: { icon: React.ElementType; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/10 p-10 text-center">
      <div className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-muted/40 text-muted-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function AccountRow({ account, onDisconnect }: { account: ConnectedAccountRow; onDisconnect: () => void }) {
  return (
    <Card className="border-border/60 bg-card/60">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <p className="text-sm font-medium">{account.account_name}</p>
          <p className="text-xs text-muted-foreground">
            {account.platform} · {account.external_account_id ?? "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{account.connection_status}</Badge>
          <Button size="sm" variant="ghost" onClick={onDisconnect}>Disconnect</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusCard({
  title, label, status, icon: Icon,
}: { title: string; label: string; status: "ok" | "pending" | "error"; icon: React.ElementType }) {
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
          <Badge variant="outline" className={tone}>{label}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
