import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Bell,
  CheckCircle2,
  Cloud,
  Database,
  Plug,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  ShieldAlert,
  SlidersHorizontal,
  Zap,
} from "lucide-react";

import { AppHeader } from "@/components/dashboard/app-header";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type {
  ConnectedAccount,
  ConnectionStatus,
  NotificationSettings,
  PublishingDefaults,
  SyncActivity,
} from "@/services/fanvueService";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Lila Studio" },
      {
        name: "description",
        content: "Configure workspace preferences and prepare Fanvue integration settings.",
      },
    ],
  }),
  component: SettingsPage,
});

const accounts: ConnectedAccount[] = [
  {
    id: "acc_a",
    accountName: "Fanvue Account A",
    platform: "fanvue",
    status: "connected",
    lastSyncTime: "2026-06-22T10:42:00Z",
    accountIdentifier: "fanvue:lila.studio",
    createdDate: "2026-04-08",
    externalPostCount: 184,
  },
  {
    id: "acc_b",
    accountName: "Fanvue Account B",
    platform: "fanvue",
    status: "disconnected",
    lastSyncTime: "2026-06-18T15:18:00Z",
    accountIdentifier: "fanvue:lila.muse",
    createdDate: "2026-05-02",
    externalPostCount: 42,
  },
];

const syncActivities: SyncActivity[] = [
  {
    id: "sync_1",
    accountId: "acc_a",
    status: "success",
    message: "Metadata sync completed",
    occurredAt: "2026-06-22 10:42",
    recordsProcessed: 18,
  },
  {
    id: "sync_2",
    accountId: "acc_b",
    status: "warning",
    message: "Skipped disconnected account",
    occurredAt: "2026-06-22 10:40",
    recordsProcessed: 0,
  },
  {
    id: "sync_3",
    accountId: "acc_a",
    status: "running",
    message: "Checking remote publishing state",
    occurredAt: "2026-06-22 10:39",
    recordsProcessed: 7,
  },
];

const notificationDefaults: NotificationSettings = {
  generation: { email: true, browser: true, inApp: true },
  publishing: { email: true, browser: false, inApp: true },
  failedUploads: { email: true, browser: true, inApp: true },
  systemAlerts: { email: false, browser: true, inApp: true },
};

function SettingsPage() {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />
        <SidebarInset className="flex min-w-0 flex-1 flex-col">
          <AppHeader />
          <main className="flex-1 bg-aurora">
            <div className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8">
              <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Workspace controls
                  </p>
                  <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight md:text-4xl">
                    Settings & Integrations
                  </h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Mock-only preferences and integration architecture prepared for production
                    wiring.
                  </p>
                </div>
                <Badge
                  className="w-fit border-primary/30 bg-primary/10 text-primary"
                  variant="outline"
                >
                  No secrets required
                </Badge>
              </div>

              <Tabs defaultValue="general" className="mt-6">
                <TabsList className="grid h-auto w-full grid-cols-2 bg-card/70 p-1 md:w-fit md:grid-cols-4">
                  <TabsTrigger value="general">General</TabsTrigger>
                  <TabsTrigger value="fanvue">Fanvue Integration</TabsTrigger>
                  <TabsTrigger value="notifications">Notifications</TabsTrigger>
                  <TabsTrigger value="system">System</TabsTrigger>
                </TabsList>
                <TabsContent value="general" className="mt-6">
                  <GeneralTab />
                </TabsContent>
                <TabsContent value="fanvue" className="mt-6">
                  <FanvueTab />
                </TabsContent>
                <TabsContent value="notifications" className="mt-6">
                  <NotificationsTab />
                </TabsContent>
                <TabsContent value="system" className="mt-6">
                  <SystemTab />
                </TabsContent>
              </Tabs>
            </div>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}

function GeneralTab() {
  const [compact, setCompact] = useState(false);
  const [autoPublish, setAutoPublish] = useState(true);
  const [manualApproval, setManualApproval] = useState(true);
  const [retryFailed, setRetryFailed] = useState(true);
  const [history, setHistory] = useState(true);
  const [retainRejected, setRetainRejected] = useState(false);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SettingsCard title="Appearance" icon={SlidersHorizontal}>
        <SelectField label="Theme selector" value="dark" values={["dark", "system", "light"]} />
        <Toggle label="Compact mode" checked={compact} onCheckedChange={setCompact} />
        <SelectField
          label="Default landing page"
          value="dashboard"
          values={["dashboard", "generate", "library", "schedule"]}
        />
      </SettingsCard>
      <SettingsCard title="Generation Preferences" icon={Zap}>
        <NumberField label="Default FPS" value="16" />
        <NumberField label="Default Scene Count" value="10" />
        <NumberField label="Default Sampling Steps" value="29" />
      </SettingsCard>
      <SettingsCard title="Publishing Preferences" icon={Cloud}>
        <Toggle
          label="Auto publish enabled"
          checked={autoPublish}
          onCheckedChange={setAutoPublish}
        />
        <Toggle
          label="Manual approval before publishing"
          checked={manualApproval}
          onCheckedChange={setManualApproval}
        />
        <Toggle
          label="Retry failed publications"
          checked={retryFailed}
          onCheckedChange={setRetryFailed}
        />
      </SettingsCard>
      <SettingsCard title="Storage Preferences" icon={Database}>
        <Toggle label="Store generation history" checked={history} onCheckedChange={setHistory} />
        <Toggle
          label="Retain rejected content"
          checked={retainRejected}
          onCheckedChange={setRetainRejected}
        />
        <p className="rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
          Empty state: no storage policy overrides have been persisted yet.
        </p>
      </SettingsCard>
    </div>
  );
}

function FanvueTab() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ConnectedAccount | null>(null);
  const [publishing, setPublishing] = useState<PublishingDefaults>({
    defaultVisibility: "subscribers",
    defaultPrice: 9.99,
    currency: "USD",
    defaultCategory: "Behind the scenes",
    watermarkEnabled: true,
    autoPublishEnabled: false,
  });
  const filtered = useMemo(
    () => accounts.filter((a) => a.accountName.toLowerCase().includes(query.toLowerCase())),
    [query],
  );
  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search connected accounts..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <SettingsCard title="Connected Accounts" icon={Plug}>
        {filtered.length ? (
          filtered.map((account) => (
            <div
              key={account.id}
              className="rounded-xl border border-border bg-background/50 p-4 transition hover:border-primary/40"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <button
                    className="font-medium hover:text-primary"
                    onClick={() => setSelected(account)}
                  >
                    {account.accountName}
                  </button>
                  <div className="mt-2 grid gap-2 text-sm text-muted-foreground sm:grid-cols-4">
                    <span>Platform: Fanvue</span>
                    <span>
                      Status: <StatusBadge status={account.status} />
                    </span>
                    <span>Last Sync: {account.lastSyncTime ?? "Never"}</span>
                    <span>ID: {account.accountIdentifier}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm">Connect</Button>
                  <Button size="sm" variant="secondary">
                    Reconnect
                  </Button>
                  <Button size="sm" variant="outline">
                    Disconnect
                  </Button>
                  <Button size="sm" variant="outline">
                    Test Connection
                  </Button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <EmptyState label="No accounts match your search." />
        )}
      </SettingsCard>
      <div className="grid gap-4 lg:grid-cols-2">
        <SettingsCard title="Publishing Defaults" icon={SlidersHorizontal}>
          <SelectField
            label="Default Visibility"
            value={publishing.defaultVisibility}
            values={["public", "subscribers", "premium"]}
            onValueChange={(v) =>
              setPublishing({
                ...publishing,
                defaultVisibility: v as PublishingDefaults["defaultVisibility"],
              })
            }
          />
          <NumberField label="Default Price" value={String(publishing.defaultPrice)} />
          <SelectField
            label="Currency"
            value={publishing.currency}
            values={["USD", "EUR", "GBP"]}
          />
          <InputField label="Default Category" value={publishing.defaultCategory} />
          <Toggle
            label="Watermark"
            checked={publishing.watermarkEnabled}
            onCheckedChange={(v) => setPublishing({ ...publishing, watermarkEnabled: v })}
          />
          <Toggle
            label="Auto Publish"
            checked={publishing.autoPublishEnabled}
            onCheckedChange={(v) => setPublishing({ ...publishing, autoPublishEnabled: v })}
          />
        </SettingsCard>
        <SettingsCard title="Synchronization" icon={RefreshCw}>
          <Toggle label="Auto Sync Enabled" checked />
          <SelectField
            label="Sync Interval"
            value="15 minutes"
            values={["15 minutes", "30 minutes", "1 hour", "6 hours"]}
          />
          <InputField label="Last Successful Sync" value="2026-06-22 10:42 UTC" />
          <Toggle label="Retry Failed Uploads" checked />
          <Separator />
          {syncActivities.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between rounded-lg bg-muted/20 p-3 text-sm"
            >
              <span>{a.message}</span>
              <Badge variant="outline">
                {a.status} · {a.recordsProcessed}
              </Badge>
            </div>
          ))}
        </SettingsCard>
      </div>
      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{selected?.accountName}</SheetTitle>
            <SheetDescription>
              Account details panel prepared for future Fanvue API data.
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="mt-6 space-y-4 text-sm">
              {[
                ["Platform", selected.platform],
                ["Account Identifier", selected.accountIdentifier],
                ["Connection Status", selected.status],
                ["Created Date", selected.createdDate],
                ["Last Sync Time", selected.lastSyncTime ?? "Never"],
                ["External Post Count", selected.externalPostCount],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-border pb-2">
                  <span className="text-muted-foreground">{k}</span>
                  <span>{v}</span>
                </div>
              ))}
              <SettingsCard title="Recent Publishing Activity" icon={CheckCircle2}>
                <p className="text-sm text-muted-foreground">
                  12 posts reconciled in the latest mock sync.
                </p>
              </SettingsCard>
              <SettingsCard title="Recent Errors" icon={ShieldAlert}>
                <EmptyState label="No recent errors for this account." />
              </SettingsCard>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function NotificationsTab() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {[
        ["Generation Notifications", "generation"],
        ["Publishing Notifications", "publishing"],
        ["Failed Upload Notifications", "failedUploads"],
        ["System Alerts", "systemAlerts"],
      ].map(([title, key]) => (
        <SettingsCard key={key} title={title} icon={Bell}>
          {(["email", "browser", "inApp"] as const).map((channel) => (
            <Toggle
              key={channel}
              label={channel === "inApp" ? "In-App" : channel[0].toUpperCase() + channel.slice(1)}
              checked={notificationDefaults[key as keyof NotificationSettings][channel]}
            />
          ))}
        </SettingsCard>
      ))}
    </div>
  );
}

function SystemTab() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <DashboardCard
        label="Application Version"
        value="v1.8.0"
        hint="settings-ready"
        icon={SettingsIcon}
      />
      <DashboardCard
        label="Supabase Status"
        value="Online"
        hint="mock status"
        icon={Database}
        accent="chart-2"
      />
      <DashboardCard
        label="RunPod Status"
        value="3 idle"
        hint="mock workers"
        icon={Zap}
        accent="chart-4"
      />
      <DashboardCard
        label="Fanvue Service Status"
        value="Ready"
        hint="UI only"
        icon={Plug}
        accent="primary"
      />
      <DashboardCard
        label="Storage Usage"
        value="68%"
        hint="1.36 TB / 2 TB"
        icon={Cloud}
        accent="chart-5"
      />
      <DashboardCard
        label="Connected Accounts Count"
        value="2"
        hint="1 connected"
        icon={CheckCircle2}
        accent="chart-2"
      />
      <DashboardCard label="Published Posts Count" value="226" hint="all time" icon={Cloud} />
      <DashboardCard
        label="Failed Publications Count"
        value="7"
        hint="last 30 days"
        icon={ShieldAlert}
        accent="chart-3"
      />
    </div>
  );
}

function SettingsCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof SettingsIcon;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-border bg-card/80 shadow-xl shadow-black/10">
      <CardContent className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </div>
          <h2 className="font-display text-lg font-semibold">{title}</h2>
        </div>
        <div className="space-y-3">{children}</div>
      </CardContent>
    </Card>
  );
}
function Toggle(props: {
  label: string;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 p-3">
      <Label>{props.label}</Label>
      <Switch checked={props.checked} onCheckedChange={props.onCheckedChange} />
    </div>
  );
}
function SelectField({
  label,
  value,
  values,
  onValueChange,
}: {
  label: string;
  value: string;
  values: string[];
  onValueChange?: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select defaultValue={value} onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {values.map((v) => (
            <SelectItem key={v} value={v}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
function NumberField({ label, value }: { label: string; value: string }) {
  return <InputField label={label} value={value} type="number" />;
}
function InputField({
  label,
  value,
  type = "text",
}: {
  label: string;
  value: string;
  type?: string;
}) {
  const [local, setLocal] = useState(value);
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type={type} value={local} onChange={(e) => setLocal(e.target.value)} />
    </div>
  );
}
function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/10 p-6 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}
function StatusBadge({ status }: { status: ConnectionStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "ml-1 capitalize",
        status === "connected" && "border-success/40 bg-success/10 text-success",
        status === "disconnected" && "border-muted-foreground/30 text-muted-foreground",
        status === "syncing" && "border-primary/40 bg-primary/10 text-primary",
        status === "error" && "border-destructive/40 bg-destructive/10 text-destructive",
      )}
    >
      {status}
    </Badge>
  );
}
