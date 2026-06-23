import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Search,
  Image as ImageIcon,
  Video as VideoIcon,
  Play,
  ArrowLeft,
  Send,
  Filter,
  Inbox,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Pause,
  Edit3,
  Trash2,
  Eye,
  RefreshCw,
  Link2,
  AlertTriangle,
  Loader2,
  Plug,
} from "lucide-react";
import { toast } from "sonner";

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { AppHeader } from "@/components/dashboard/app-header";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/schedule")({
  head: () => ({
    meta: [
      { title: "Scheduling — Lila Studio" },
      {
        name: "description",
        content:
          "Schedule, queue and publish approved content to connected Fanvue accounts.",
      },
    ],
  }),
  component: SchedulePage,
});

// ---------- Types ----------

type PublishStatus =
  | "scheduled"
  | "publishing"
  | "published"
  | "failed";

type QueueStatus = "waiting" | "ready" | "publishing" | "published" | "failed";
type ContentType = "image" | "video";

type ConnectedAccount = {
  id: string;
  platform: "fanvue";
  name: string;
  handle: string;
  status: "connected" | "disconnected" | "error";
};

type HistoryEvent = {
  at: string;
  label: string;
  kind: "approved" | "scheduled" | "queued" | "publishing" | "published" | "failed" | "retried";
  by?: string;
};

type ScheduledItem = {
  id: string;
  contentName: string;
  type: ContentType;
  character: string;
  thumbnail: string;
  referenceImage?: string;
  accountId: string;
  scheduledAt: string; // ISO
  status: PublishStatus;
  queueStatus: QueueStatus;
  autoPublish: boolean;
  notes?: string;
  externalPostId?: string;
  publishedAt?: string;
  reviewStatus: "approved";
  settings: {
    fps: number;
    framesPerScene: number;
    numScenes: number;
    samplingSteps: number;
  };
  scenePrompts: string[];
  negativePrompt: string;
  history: HistoryEvent[];
};

// ---------- Mock data ----------

const accounts: ConnectedAccount[] = [
  { id: "acc_a", platform: "fanvue", name: "Fanvue Account A", handle: "@lila.studio", status: "connected" },
  { id: "acc_b", platform: "fanvue", name: "Fanvue Account B", handle: "@lila.muse", status: "connected" },
  { id: "acc_c", platform: "fanvue", name: "Fanvue Account C", handle: "@lila.noir", status: "error" },
];

const IMG_A = "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=600&q=80";
const IMG_B = "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=600&q=80";
const IMG_C = "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&q=80";
const IMG_D = "https://images.unsplash.com/photo-1488161628813-04466f872be2?w=600&q=80";
const IMG_E = "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=600&q=80";
const IMG_F = "https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=600&q=80";

const today = new Date();
const at = (dayOffset: number, hour: number, min = 0) => {
  const d = new Date(today);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
};

const characters = ["Aria", "Nova", "Luna", "Veda", "Mira"];

const baseSettings = { fps: 16, framesPerScene: 257, numScenes: 10, samplingSteps: 29 };

const scenePromptsSample = [
  "Soft morning light, character looks toward window, gentle smile, cinematic depth of field",
  "Close-up portrait, neutral expression, shallow focus on eyes, warm rim light",
  "Walking through hallway, slow camera dolly, ambient haze",
  "Sitting near desk, casual pose, low key lighting",
];

const negativePromptSample =
  "low quality, blurry, distorted hands, extra fingers, watermark, text overlay, deformed face";

const initialItems: ScheduledItem[] = [
  {
    id: "sch_001",
    contentName: "Aria — Morning Studio v3",
    type: "video",
    character: "Aria",
    thumbnail: IMG_A,
    referenceImage: IMG_C,
    accountId: "acc_a",
    scheduledAt: at(0, 18, 30),
    status: "scheduled",
    queueStatus: "ready",
    autoPublish: true,
    notes: "Lead promo for Friday drop.",
    reviewStatus: "approved",
    settings: baseSettings,
    scenePrompts: scenePromptsSample,
    negativePrompt: negativePromptSample,
    history: [
      { at: at(-2, 11), label: "Approved by Maya", kind: "approved", by: "Maya" },
      { at: at(-2, 12), label: "Scheduled for 18:30", kind: "scheduled", by: "Maya" },
      { at: at(0, 17, 55), label: "Queued for publish", kind: "queued" },
    ],
  },
  {
    id: "sch_002",
    contentName: "Nova — Window Light",
    type: "image",
    character: "Nova",
    thumbnail: IMG_B,
    referenceImage: IMG_D,
    accountId: "acc_b",
    scheduledAt: at(0, 21, 0),
    status: "scheduled",
    queueStatus: "waiting",
    autoPublish: true,
    reviewStatus: "approved",
    settings: baseSettings,
    scenePrompts: scenePromptsSample.slice(0, 2),
    negativePrompt: negativePromptSample,
    history: [
      { at: at(-1, 14), label: "Approved by Jordan", kind: "approved", by: "Jordan" },
      { at: at(-1, 14, 5), label: "Scheduled for 21:00", kind: "scheduled", by: "Jordan" },
    ],
  },
  {
    id: "sch_003",
    contentName: "Luna — Hallway Walk",
    type: "video",
    character: "Luna",
    thumbnail: IMG_C,
    accountId: "acc_a",
    scheduledAt: at(1, 9, 0),
    status: "scheduled",
    queueStatus: "waiting",
    autoPublish: false,
    reviewStatus: "approved",
    settings: baseSettings,
    scenePrompts: scenePromptsSample,
    negativePrompt: negativePromptSample,
    history: [
      { at: at(-1, 9), label: "Approved by Maya", kind: "approved", by: "Maya" },
      { at: at(-1, 9, 5), label: "Scheduled for tomorrow 09:00", kind: "scheduled" },
    ],
  },
  {
    id: "sch_004",
    contentName: "Veda — Desk Portrait",
    type: "image",
    character: "Veda",
    thumbnail: IMG_D,
    accountId: "acc_b",
    scheduledAt: at(2, 16, 30),
    status: "scheduled",
    queueStatus: "waiting",
    autoPublish: true,
    reviewStatus: "approved",
    settings: baseSettings,
    scenePrompts: scenePromptsSample,
    negativePrompt: negativePromptSample,
    history: [{ at: at(-1, 10), label: "Scheduled", kind: "scheduled" }],
  },
  {
    id: "sch_005",
    contentName: "Mira — Golden Hour Loop",
    type: "video",
    character: "Mira",
    thumbnail: IMG_E,
    accountId: "acc_a",
    scheduledAt: at(-1, 20, 0),
    status: "published",
    queueStatus: "published",
    autoPublish: true,
    reviewStatus: "approved",
    externalPostId: "fv_mock_video_1718995200",
    publishedAt: at(-1, 20, 1),
    settings: baseSettings,
    scenePrompts: scenePromptsSample,
    negativePrompt: negativePromptSample,
    history: [
      { at: at(-2, 9), label: "Approved", kind: "approved" },
      { at: at(-2, 9, 5), label: "Scheduled", kind: "scheduled" },
      { at: at(-1, 20), label: "Publishing", kind: "publishing" },
      { at: at(-1, 20, 1), label: "Published to Fanvue Account A", kind: "published" },
    ],
  },
  {
    id: "sch_006",
    contentName: "Aria — Soft Promo",
    type: "image",
    character: "Aria",
    thumbnail: IMG_F,
    accountId: "acc_b",
    scheduledAt: at(-2, 12, 0),
    status: "published",
    queueStatus: "published",
    autoPublish: true,
    reviewStatus: "approved",
    externalPostId: "fv_mock_image_1718822400",
    publishedAt: at(-2, 12, 0),
    settings: baseSettings,
    scenePrompts: scenePromptsSample.slice(0, 1),
    negativePrompt: negativePromptSample,
    history: [
      { at: at(-3, 8), label: "Approved", kind: "approved" },
      { at: at(-2, 12), label: "Published to Fanvue Account B", kind: "published" },
    ],
  },
  {
    id: "sch_007",
    contentName: "Nova — Late Night Teaser",
    type: "video",
    character: "Nova",
    thumbnail: IMG_B,
    accountId: "acc_c",
    scheduledAt: at(-1, 23, 0),
    status: "failed",
    queueStatus: "failed",
    autoPublish: true,
    reviewStatus: "approved",
    notes: "Token expired on Fanvue Account C.",
    settings: baseSettings,
    scenePrompts: scenePromptsSample,
    negativePrompt: negativePromptSample,
    history: [
      { at: at(-2, 10), label: "Approved", kind: "approved" },
      { at: at(-1, 23), label: "Publishing", kind: "publishing" },
      { at: at(-1, 23, 1), label: "Failed — invalid credentials", kind: "failed" },
    ],
  },
  {
    id: "sch_008",
    contentName: "Luna — Studio Set 2",
    type: "image",
    character: "Luna",
    thumbnail: IMG_C,
    accountId: "acc_a",
    scheduledAt: at(3, 11, 15),
    status: "scheduled",
    queueStatus: "waiting",
    autoPublish: false,
    reviewStatus: "approved",
    settings: baseSettings,
    scenePrompts: scenePromptsSample.slice(0, 2),
    negativePrompt: negativePromptSample,
    history: [{ at: at(0, 9), label: "Scheduled", kind: "scheduled" }],
  },
];

// ---------- Helpers ----------

const statusStyle: Record<PublishStatus, string> = {
  scheduled: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  publishing: "bg-primary/15 text-primary border-primary/30",
  published: "bg-success/15 text-success border-success/30",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
};

const queueStatusStyle: Record<QueueStatus, string> = {
  waiting: "bg-muted text-muted-foreground border-border",
  ready: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  publishing: "bg-primary/15 text-primary border-primary/30",
  published: "bg-success/15 text-success border-success/30",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
};

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
const fmtDateTime = (iso: string) =>
  `${fmtDate(iso)} · ${fmtTime(iso)}`;

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

function StatusBadge({ status }: { status: PublishStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
        statusStyle[status],
      )}
    >
      {status === "publishing" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      {status}
    </span>
  );
}

function QueueBadge({ status }: { status: QueueStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
        queueStatusStyle[status],
      )}
    >
      {status}
    </span>
  );
}

// ---------- Page ----------

function SchedulePage() {
  const [items, setItems] = useState<ScheduledItem[]>(initialItems);
  const [tab, setTab] = useState("calendar");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | PublishStatus>("all");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [characterFilter, setCharacterFilter] = useState<string>("all");
  const [rangeFilter, setRangeFilter] = useState<"all" | "today" | "week" | "month">("all");
  const [selected, setSelected] = useState<ScheduledItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Calendar nav state (week view)
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay()); // Sunday start
    return d;
  });

  const getAccount = (id: string) => accounts.find((a) => a.id === id);

  // ---------- Stats ----------
  const stats = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    return {
      scheduled: items.filter((i) => i.status === "scheduled").length,
      todayCount: items.filter(
        (i) => i.status === "scheduled" && isSameDay(new Date(i.scheduledAt), now),
      ).length,
      weekPublished: items.filter(
        (i) =>
          i.status === "published" &&
          i.publishedAt &&
          new Date(i.publishedAt) >= weekAgo,
      ).length,
      failed: items.filter((i) => i.status === "failed").length,
      connectedAccounts: accounts.filter((a) => a.status === "connected").length,
    };
  }, [items]);

  // ---------- Filtering ----------
  const filteredItems = useMemo(() => {
    const now = new Date();
    return items.filter((i) => {
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (accountFilter !== "all" && i.accountId !== accountFilter) return false;
      if (characterFilter !== "all" && i.character !== characterFilter) return false;

      if (rangeFilter !== "all") {
        const d = new Date(i.scheduledAt);
        if (rangeFilter === "today" && !isSameDay(d, now)) return false;
        if (rangeFilter === "week") {
          const wkAhead = new Date(now);
          wkAhead.setDate(wkAhead.getDate() + 7);
          if (d < now || d > wkAhead) return false;
        }
        if (rangeFilter === "month") {
          if (
            d.getMonth() !== now.getMonth() ||
            d.getFullYear() !== now.getFullYear()
          )
            return false;
        }
      }

      if (search.trim()) {
        const q = search.toLowerCase();
        const acc = getAccount(i.accountId);
        const hay = [
          i.contentName,
          i.character,
          acc?.name,
          acc?.handle,
          i.externalPostId,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, statusFilter, accountFilter, characterFilter, rangeFilter, search]);

  // ---------- Mutations ----------
  const updateItem = (id: string, patch: Partial<ScheduledItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    toast.success("Schedule removed");
    setSelected(null);
  };

  const retryPublish = (id: string) => {
    updateItem(id, {
      status: "scheduled",
      queueStatus: "ready",
      history: [
        ...(items.find((i) => i.id === id)?.history ?? []),
        { at: new Date().toISOString(), label: "Retry queued", kind: "retried" },
      ],
    });
    toast.success("Queued for retry");
  };

  const publishNow = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    updateItem(id, { status: "publishing", queueStatus: "publishing" });
    setTimeout(() => {
      const ok = Math.random() > 0.15;
      const now = new Date().toISOString();
      if (ok) {
        updateItem(id, {
          status: "published",
          queueStatus: "published",
          publishedAt: now,
          externalPostId: `fv_mock_${item.type}_${Date.now()}`,
          history: [
            ...item.history,
            { at: now, label: "Published", kind: "published" },
          ],
        });
        toast.success("Published to Fanvue");
      } else {
        updateItem(id, {
          status: "failed",
          queueStatus: "failed",
          history: [
            ...item.history,
            { at: now, label: "Publish failed", kind: "failed" },
          ],
        });
        toast.error("Publish failed");
      }
    }, 1200);
  };

  const pauseItem = (id: string) => {
    updateItem(id, { autoPublish: false });
    toast.message("Auto-publish paused");
  };

  // ---------- Drag and drop ----------
  const [dragId, setDragId] = useState<string | null>(null);

  const onDropOnDay = (day: Date) => {
    if (!dragId) return;
    const item = items.find((i) => i.id === dragId);
    if (!item) return;
    const oldD = new Date(item.scheduledAt);
    const newD = new Date(day);
    newD.setHours(oldD.getHours(), oldD.getMinutes(), 0, 0);
    updateItem(dragId, {
      scheduledAt: newD.toISOString(),
      history: [
        ...item.history,
        {
          at: new Date().toISOString(),
          label: `Rescheduled to ${fmtDateTime(newD.toISOString())}`,
          kind: "scheduled",
        },
      ],
    });
    toast.success("Schedule updated");
    setDragId(null);
  };

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        <main className="flex-1 overflow-y-auto bg-background">
          <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Link
                  to="/"
                  className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Dashboard
                </Link>
                <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
                  Scheduling
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Plan, queue and publish approved content to your connected Fanvue accounts.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-2">
                  <Plug className="h-4 w-4" /> Accounts
                </Button>
                <Button size="sm" className="gap-2" onClick={() => setCreateOpen(true)}>
                  <CalendarPlus className="h-4 w-4" /> Schedule content
                </Button>
              </div>
            </div>

            {/* Stats */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <DashboardCard
                label="Scheduled posts"
                value={stats.scheduled}
                icon={CalendarClock}
                accent="primary"
                hint="Awaiting publish"
              />
              <DashboardCard
                label="Publishing today"
                value={stats.todayCount}
                icon={Clock}
                accent="chart-2"
                hint="In the next 24h"
              />
              <DashboardCard
                label="Published this week"
                value={stats.weekPublished}
                icon={CheckCircle2}
                accent="chart-3"
                delta={12}
              />
              <DashboardCard
                label="Failed publications"
                value={stats.failed}
                icon={AlertTriangle}
                accent="chart-5"
                hint={stats.failed ? "Needs attention" : "All clear"}
              />
              <DashboardCard
                label="Connected accounts"
                value={`${stats.connectedAccounts}/${accounts.length}`}
                icon={Link2}
                accent="chart-4"
                hint="Fanvue"
              />
            </div>

            {/* Filters */}
            <Card className="border-border/60 bg-card">
              <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search character, content, account, post ID…"
                    className="pl-9"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as never)}>
                    <SelectTrigger className="h-9 w-[150px]">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="scheduled">Scheduled</SelectItem>
                      <SelectItem value="publishing">Publishing</SelectItem>
                      <SelectItem value="published">Published</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={accountFilter} onValueChange={setAccountFilter}>
                    <SelectTrigger className="h-9 w-[180px]">
                      <SelectValue placeholder="Account" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All accounts</SelectItem>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={characterFilter} onValueChange={setCharacterFilter}>
                    <SelectTrigger className="h-9 w-[150px]">
                      <SelectValue placeholder="Character" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All characters</SelectItem>
                      {characters.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={rangeFilter} onValueChange={(v) => setRangeFilter(v as never)}>
                    <SelectTrigger className="h-9 w-[140px]">
                      <SelectValue placeholder="Date range" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any time</SelectItem>
                      <SelectItem value="today">Today</SelectItem>
                      <SelectItem value="week">Next 7 days</SelectItem>
                      <SelectItem value="month">This month</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Tabs */}
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="calendar">Calendar view</TabsTrigger>
                <TabsTrigger value="queue">Publishing queue</TabsTrigger>
                <TabsTrigger value="history">Publishing history</TabsTrigger>
              </TabsList>

              <TabsContent value="calendar" className="mt-4">
                <CalendarView
                  weekStart={weekStart}
                  setWeekStart={setWeekStart}
                  items={filteredItems}
                  getAccount={getAccount}
                  onOpen={setSelected}
                  onDragStart={setDragId}
                  onDropOnDay={onDropOnDay}
                  onSchedule={() => setCreateOpen(true)}
                />
              </TabsContent>

              <TabsContent value="queue" className="mt-4">
                <QueueView
                  items={filteredItems.filter((i) =>
                    ["scheduled", "publishing", "failed"].includes(i.status),
                  )}
                  getAccount={getAccount}
                  onOpen={setSelected}
                  onPause={pauseItem}
                  onCancel={removeItem}
                  onPublishNow={publishNow}
                  onRetry={retryPublish}
                  onSchedule={() => setCreateOpen(true)}
                />
              </TabsContent>

              <TabsContent value="history" className="mt-4">
                <HistoryView
                  items={filteredItems.filter((i) =>
                    ["published", "failed"].includes(i.status),
                  )}
                  getAccount={getAccount}
                  onOpen={setSelected}
                  onRetry={retryPublish}
                />
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </SidebarInset>

      <DetailSheet
        item={selected}
        onClose={() => setSelected(null)}
        getAccount={getAccount}
        onRetry={retryPublish}
        onPublishNow={publishNow}
        onRemove={removeItem}
      />

      <CreateScheduleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={(item) => {
          setItems((prev) => [item, ...prev]);
          toast.success("Content scheduled");
        }}
      />
    </SidebarProvider>
  );
}

// ---------- Calendar view ----------

function CalendarView({
  weekStart,
  setWeekStart,
  items,
  getAccount,
  onOpen,
  onDragStart,
  onDropOnDay,
  onSchedule,
}: {
  weekStart: Date;
  setWeekStart: (d: Date) => void;
  items: ScheduledItem[];
  getAccount: (id: string) => ConnectedAccount | undefined;
  onOpen: (i: ScheduledItem) => void;
  onDragStart: (id: string | null) => void;
  onDropOnDay: (d: Date) => void;
  onSchedule: () => void;
}) {
  const days = Array.from({ length: 7 }).map((_, idx) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + idx);
    return d;
  });

  const move = (delta: number) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + delta * 7);
    setWeekStart(d);
  };

  const todayD = new Date();

  const itemsByDay = (day: Date) =>
    items
      .filter((i) => isSameDay(new Date(i.scheduledAt), day))
      .sort(
        (a, b) =>
          new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
      );

  return (
    <Card className="border-border/60 bg-card">
      <CardContent className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="font-display text-lg font-semibold">
              {weekStart.toLocaleDateString([], { month: "long", year: "numeric" })}
            </p>
            <p className="text-xs text-muted-foreground">
              Week of {fmtDate(weekStart.toISOString())} — drag cards between days to reschedule
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => move(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => {
                const d = new Date();
                d.setHours(0, 0, 0, 0);
                d.setDate(d.getDate() - d.getDay());
                setWeekStart(d);
              }}
            >
              Today
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => move(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {items.length === 0 ? (
          <EmptyState onSchedule={onSchedule} />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
            {days.map((day) => {
              const dayItems = itemsByDay(day);
              const isToday = isSameDay(day, todayD);
              return (
                <div
                  key={day.toISOString()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDropOnDay(day)}
                  className={cn(
                    "flex min-h-[260px] flex-col rounded-lg border border-border/60 bg-background/40 p-2 transition-colors",
                    "hover:border-primary/40",
                  )}
                >
                  <div className="mb-2 flex items-baseline justify-between px-1">
                    <p
                      className={cn(
                        "text-[10px] font-medium uppercase tracking-wider",
                        isToday ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {day.toLocaleDateString([], { weekday: "short" })}
                    </p>
                    <p
                      className={cn(
                        "font-display text-lg font-semibold",
                        isToday ? "text-primary" : "text-foreground",
                      )}
                    >
                      {day.getDate()}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {dayItems.map((i) => (
                      <CalendarCard
                        key={i.id}
                        item={i}
                        account={getAccount(i.accountId)}
                        onOpen={() => onOpen(i)}
                        onDragStart={() => onDragStart(i.id)}
                      />
                    ))}
                    {dayItems.length === 0 && (
                      <p className="px-1 pt-2 text-[11px] text-muted-foreground/70">
                        Nothing scheduled
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CalendarCard({
  item,
  account,
  onOpen,
  onDragStart,
}: {
  item: ScheduledItem;
  account?: ConnectedAccount;
  onOpen: () => void;
  onDragStart: () => void;
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
      className="group flex flex-col gap-1.5 rounded-md border border-border/60 bg-card p-1.5 text-left transition-all hover:border-primary/50 hover:shadow-[0_0_20px_-8px_var(--primary)]"
    >
      <div className="relative h-16 w-full overflow-hidden rounded">
        <img
          src={item.thumbnail}
          alt={item.contentName}
          className="h-full w-full object-cover"
        />
        <div className="absolute left-1 top-1 grid h-5 w-5 place-items-center rounded bg-black/60 backdrop-blur">
          {item.type === "video" ? (
            <VideoIcon className="h-3 w-3 text-white" />
          ) : (
            <ImageIcon className="h-3 w-3 text-white" />
          )}
        </div>
        <div className="absolute right-1 top-1">
          <StatusBadge status={item.status} />
        </div>
      </div>
      <div className="px-0.5">
        <p className="truncate text-xs font-medium text-foreground">{item.character}</p>
        <div className="mt-0.5 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {fmtTime(item.scheduledAt)}
          </span>
          <span className="truncate text-[10px] text-muted-foreground">
            {account?.name.replace("Fanvue Account ", "Acc ")}
          </span>
        </div>
      </div>
    </button>
  );
}

// ---------- Queue view ----------

function QueueView({
  items,
  getAccount,
  onOpen,
  onPause,
  onCancel,
  onPublishNow,
  onRetry,
  onSchedule,
}: {
  items: ScheduledItem[];
  getAccount: (id: string) => ConnectedAccount | undefined;
  onOpen: (i: ScheduledItem) => void;
  onPause: (id: string) => void;
  onCancel: (id: string) => void;
  onPublishNow: (id: string) => void;
  onRetry: (id: string) => void;
  onSchedule: () => void;
}) {
  if (items.length === 0) {
    return (
      <Card className="border-border/60 bg-card">
        <CardContent className="p-4">
          <EmptyState
            onSchedule={onSchedule}
            message="The publishing queue is empty."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3">
      {items.map((i) => {
        const account = getAccount(i.accountId);
        return (
          <Card
            key={i.id}
            className="border-border/60 bg-card transition-colors hover:border-primary/40"
          >
            <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => onOpen(i)}
                className="relative h-20 w-32 shrink-0 overflow-hidden rounded-md bg-muted"
              >
                <img
                  src={i.thumbnail}
                  alt={i.contentName}
                  className="h-full w-full object-cover transition-transform hover:scale-105"
                />
                {i.type === "video" && (
                  <div className="absolute inset-0 grid place-items-center bg-black/30">
                    <Play className="h-5 w-5 text-white" />
                  </div>
                )}
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {i.contentName}
                  </p>
                  <QueueBadge status={i.queueStatus} />
                  {!i.autoPublish && (
                    <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      manual
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {i.character} · {account?.name ?? "Unknown account"}
                </p>
                <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {fmtDateTime(i.scheduledAt)}
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                {i.status === "failed" ? (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onRetry(i.id)}>
                    <RefreshCw className="h-3.5 w-3.5" /> Retry
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => onPublishNow(i.id)}
                    disabled={i.status === "publishing"}
                  >
                    <Send className="h-3.5 w-3.5" /> Publish now
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-8 w-8">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onOpen(i)}>
                      <Eye className="mr-2 h-4 w-4" /> View details
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onOpen(i)}>
                      <Edit3 className="mr-2 h-4 w-4" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onPause(i.id)}>
                      <Pause className="mr-2 h-4 w-4" /> Pause auto-publish
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => onCancel(i.id)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Cancel
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ---------- History view ----------

function HistoryView({
  items,
  getAccount,
  onOpen,
  onRetry,
}: {
  items: ScheduledItem[];
  getAccount: (id: string) => ConnectedAccount | undefined;
  onOpen: (i: ScheduledItem) => void;
  onRetry: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <Card className="border-border/60 bg-card">
        <CardContent className="p-10">
          <div className="mx-auto max-w-md text-center">
            <Inbox className="mx-auto h-10 w-10 text-muted-foreground/60" />
            <p className="mt-3 font-medium text-foreground">No publishing history yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Published and failed posts will appear here.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60 bg-card">
      <CardContent className="p-0">
        <div className="grid grid-cols-12 gap-3 border-b border-border/60 px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <div className="col-span-5">Content</div>
          <div className="col-span-2">Account</div>
          <div className="col-span-2">Publish date</div>
          <div className="col-span-2">External ID</div>
          <div className="col-span-1 text-right">Status</div>
        </div>
        {items.map((i) => {
          const account = getAccount(i.accountId);
          return (
            <button
              key={i.id}
              type="button"
              onClick={() => onOpen(i)}
              className="grid w-full grid-cols-12 items-center gap-3 border-b border-border/40 px-4 py-3 text-left transition-colors hover:bg-muted/40 last:border-b-0"
            >
              <div className="col-span-5 flex items-center gap-3">
                <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded">
                  <img
                    src={i.thumbnail}
                    alt={i.contentName}
                    className="h-full w-full object-cover"
                  />
                  {i.type === "video" && (
                    <div className="absolute inset-0 grid place-items-center bg-black/30">
                      <Play className="h-3.5 w-3.5 text-white" />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{i.contentName}</p>
                  <p className="truncate text-xs text-muted-foreground">{i.character}</p>
                </div>
              </div>
              <div className="col-span-2 text-xs text-muted-foreground">
                <p className="truncate text-foreground">{account?.name}</p>
                <p className="truncate">{account?.handle}</p>
              </div>
              <div className="col-span-2 text-xs text-muted-foreground">
                {i.publishedAt ? fmtDateTime(i.publishedAt) : fmtDateTime(i.scheduledAt)}
              </div>
              <div className="col-span-2 truncate font-mono text-[11px] text-muted-foreground">
                {i.externalPostId ?? "—"}
              </div>
              <div className="col-span-1 flex items-center justify-end gap-2">
                <StatusBadge status={i.status} />
                {i.status === "failed" && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRetry(i.id);
                    }}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ---------- Empty state ----------

function EmptyState({
  onSchedule,
  message = "No scheduled content.",
}: {
  onSchedule: () => void;
  message?: string;
}) {
  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-border/60 bg-background">
        <CalendarClock className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="mt-4 font-display text-lg font-semibold text-foreground">
        {message}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick an approved asset from the library and schedule it to a connected Fanvue account.
      </p>
      <Button size="sm" className="mt-5 gap-2" onClick={onSchedule}>
        <CalendarPlus className="h-4 w-4" /> Schedule content
      </Button>
    </div>
  );
}

// ---------- Detail sheet ----------

function DetailSheet({
  item,
  onClose,
  getAccount,
  onRetry,
  onPublishNow,
  onRemove,
}: {
  item: ScheduledItem | null;
  onClose: () => void;
  getAccount: (id: string) => ConnectedAccount | undefined;
  onRetry: (id: string) => void;
  onPublishNow: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const open = !!item;
  const account = item ? getAccount(item.accountId) : undefined;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {item && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                {item.contentName}
                <StatusBadge status={item.status} />
              </SheetTitle>
              <SheetDescription>
                {item.character} · {item.type === "video" ? "Video" : "Image"} · {fmtDateTime(item.scheduledAt)}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-6">
              <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
                <img
                  src={item.thumbnail}
                  alt={item.contentName}
                  className="h-full w-full object-cover"
                />
                {item.type === "video" && (
                  <div className="absolute inset-0 grid place-items-center bg-black/30">
                    <Play className="h-10 w-10 text-white" />
                  </div>
                )}
              </div>

              {/* Schedule + account */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Scheduled" value={fmtDateTime(item.scheduledAt)} />
                <Field
                  label="Connected account"
                  value={account ? `${account.name} (${account.handle})` : "—"}
                />
                <Field
                  label="Mode"
                  value={item.autoPublish ? "Auto publish" : "Manual publish"}
                />
                <Field label="Review status" value="Approved" />
              </div>

              {item.referenceImage && (
                <div>
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Reference image
                  </p>
                  <div className="h-24 w-24 overflow-hidden rounded-md border border-border">
                    <img
                      src={item.referenceImage}
                      alt="reference"
                      className="h-full w-full object-cover"
                    />
                  </div>
                </div>
              )}

              {/* Settings */}
              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Generation settings
                </p>
                <div className="grid grid-cols-4 gap-2">
                  <Mini label="FPS" value={item.settings.fps} />
                  <Mini label="Frames" value={item.settings.framesPerScene} />
                  <Mini label="Scenes" value={item.settings.numScenes} />
                  <Mini label="Steps" value={item.settings.samplingSteps} />
                </div>
              </div>

              {/* Prompts */}
              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Scene prompts
                </p>
                <ScrollArea className="h-40 rounded-md border border-border bg-background/40 p-3">
                  <ol className="space-y-2 text-xs text-foreground">
                    {item.scenePrompts.map((p, idx) => (
                      <li key={idx} className="leading-relaxed">
                        <span className="mr-1 text-muted-foreground">{idx + 1}.</span>
                        {p}
                      </li>
                    ))}
                  </ol>
                </ScrollArea>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Negative prompt
                </p>
                <p className="rounded-md border border-border bg-background/40 p-3 text-xs text-muted-foreground">
                  {item.negativePrompt}
                </p>
              </div>

              {/* Publish info */}
              {(item.externalPostId || item.publishedAt) && (
                <div className="grid grid-cols-2 gap-3">
                  {item.publishedAt && (
                    <Field label="Published at" value={fmtDateTime(item.publishedAt)} />
                  )}
                  {item.externalPostId && (
                    <Field label="External post ID" value={item.externalPostId} mono />
                  )}
                </div>
              )}

              {/* History */}
              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Publishing history
                </p>
                <ol className="relative space-y-3 border-l border-border pl-4">
                  {item.history.map((h, idx) => (
                    <li key={idx} className="relative">
                      <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background" />
                      <p className="text-xs font-medium text-foreground">{h.label}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {fmtDateTime(h.at)}
                        {h.by ? ` · ${h.by}` : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>

              <Separator />

              <div className="flex flex-wrap items-center gap-2">
                {item.status === "failed" ? (
                  <Button size="sm" className="gap-2" onClick={() => onRetry(item.id)}>
                    <RefreshCw className="h-4 w-4" /> Retry publication
                  </Button>
                ) : item.status !== "published" ? (
                  <Button size="sm" className="gap-2" onClick={() => onPublishNow(item.id)}>
                    <Send className="h-4 w-4" /> Publish now
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 text-destructive hover:text-destructive"
                  onClick={() => onRemove(item.id)}
                >
                  <Trash2 className="h-4 w-4" /> Remove schedule
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-sm text-foreground",
          mono && "font-mono text-xs break-all",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-2 text-center">
      <p className="font-display text-lg font-semibold text-foreground">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}

// ---------- Create dialog ----------

const approvedAssets: Array<Pick<ScheduledItem, "contentName" | "type" | "character" | "thumbnail">> = [
  { contentName: "Aria — Studio Promo v4", type: "video", character: "Aria", thumbnail: IMG_A },
  { contentName: "Nova — Window Light B", type: "image", character: "Nova", thumbnail: IMG_B },
  { contentName: "Luna — Soft Portraits", type: "image", character: "Luna", thumbnail: IMG_C },
  { contentName: "Veda — Hallway Set", type: "video", character: "Veda", thumbnail: IMG_D },
  { contentName: "Mira — Cozy Loop", type: "video", character: "Mira", thumbnail: IMG_E },
];

function CreateScheduleDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreate: (i: ScheduledItem) => void;
}) {
  const [contentIdx, setContentIdx] = useState("0");
  const [accountId, setAccountId] = useState(accounts[0].id);
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [time, setTime] = useState("18:00");
  const [autoPublish, setAutoPublish] = useState(true);
  const [notes, setNotes] = useState("");

  const reset = () => {
    setContentIdx("0");
    setAccountId(accounts[0].id);
    setNotes("");
    setAutoPublish(true);
  };

  const submit = () => {
    const c = approvedAssets[Number(contentIdx)];
    const iso = new Date(`${date}T${time}:00`).toISOString();
    const item: ScheduledItem = {
      id: `sch_${Date.now()}`,
      contentName: c.contentName,
      type: c.type,
      character: c.character,
      thumbnail: c.thumbnail,
      accountId,
      scheduledAt: iso,
      status: "scheduled",
      queueStatus: "waiting",
      autoPublish,
      notes: notes || undefined,
      reviewStatus: "approved",
      settings: baseSettings,
      scenePrompts: scenePromptsSample,
      negativePrompt: negativePromptSample,
      history: [
        {
          at: new Date().toISOString(),
          label: `Scheduled for ${fmtDateTime(iso)}`,
          kind: "scheduled",
        },
      ],
    };
    onCreate(item);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Schedule content</DialogTitle>
          <DialogDescription>
            Queue an approved asset for publishing to a connected Fanvue account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Content</Label>
            <Select value={contentIdx} onValueChange={setContentIdx}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {approvedAssets.map((a, idx) => (
                  <SelectItem key={idx} value={String(idx)}>
                    {a.contentName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Publishing account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id} disabled={a.status !== "connected"}>
                    {a.name} {a.status !== "connected" ? "· offline" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Time</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Publishing notes</Label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional context for reviewers or publishers…"
            />
          </div>

          <label className="flex items-center justify-between rounded-md border border-border bg-background/40 p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Auto publish</p>
              <p className="text-xs text-muted-foreground">
                Push automatically at the scheduled time. Turn off to require manual approval.
              </p>
            </div>
            <input
              type="checkbox"
              checked={autoPublish}
              onChange={(e) => setAutoPublish(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} className="gap-2">
            <CalendarPlus className="h-4 w-4" /> Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
