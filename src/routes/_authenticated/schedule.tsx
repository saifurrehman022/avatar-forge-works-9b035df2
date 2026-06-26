import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { scheduleService } from "@/services";
import {
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Search,
  Image as ImageIcon,
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
  CheckCircle,
  XCircle,
  ExternalLink,
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
import { Badge } from "@/components/ui/badge";
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

// ---------------------------------------------------------------------------
// Fanvue Configuration
// ---------------------------------------------------------------------------
const FANVUE_CLIENT_ID     = "f9d35fff-3d12-4dd5-8945-750c37d65ae9";
const FANVUE_CLIENT_SECRET = "05275891c81581c5cb79d336c8e9f87680f0976843bf17d6737bdcf0dde38b1a"; 
const FANVUE_REDIRECT_URI  = "https://avatar-forge-works-9b035df2-j56ivc6di-saifurrehman022s-projects.vercel.app/schedule";
const FANVUE_AUTH_URL       = "https://auth.fanvue.com/oauth2/auth"; 
const FANVUE_TOKEN_URL      = "https://auth.fanvue.com/oauth2/token";
const FANVUE_API_BASE        = "https://api.fanvue.com";

// ---------------------------------------------------------------------------
// Fanvue OAuth Engine
// ---------------------------------------------------------------------------

function startFanvueOAuth() {
  const params = new URLSearchParams({
    client_id: FANVUE_CLIENT_ID,
    redirect_uri: FANVUE_REDIRECT_URI,
    response_type: "code",
    scope: "openid profile posts:write",
    state: crypto.randomUUID(),
  });
  window.location.href = `${FANVUE_AUTH_URL}?${params.toString()}`;
}

async function exchangeFanvueCode(code: string): Promise<void> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: FANVUE_REDIRECT_URI,
    client_id: FANVUE_CLIENT_ID,
    client_secret: FANVUE_CLIENT_SECRET,
  });

  const res = await fetch(FANVUE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Fanvue token exchange failed: ${err}`);
  }

  const tokens = await res.json();
  const accessToken  = tokens.access_token as string;
  const refreshToken = tokens.refresh_token as string | undefined;
  const expiresIn    = tokens.expires_in as number | undefined;

  const profileRes = await fetch(`${FANVUE_API_BASE}/v1/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = profileRes.ok ? await profileRes.json() : {};
  const handle   = profile.username ?? profile.handle ?? profile.id ?? "fanvue-user";
  const name     = profile.displayName ?? profile.name ?? handle;

  const { data: userRes } = await supabase.auth.getUser();

  const { error } = await supabase.from("connected_accounts").upsert(
    {
      account_name: name,
      external_account_id: handle,
      platform: "fanvue",
      connection_status: "connected",
      access_token: accessToken,
      refresh_token: refreshToken ?? null,
      token_expires_at: expiresIn
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : null,
      created_by: userRes.user?.id ?? null,
    },
    { onConflict: "external_account_id" }
  );
  if (error) throw new Error(`Failed to save account: ${error.message}`);
}

/** Post an image asset to Fanvue by uploading the raw binary data */
async function publishToFanvue(params: {
  accessToken: string;
  mediaUrl: string;
  mediaType: "image" | "video";
  caption: string;
}): Promise<string> {
  if (params.mediaType !== "image") {
    throw new Error("This pipeline is currently configured for image processing only.");
  }

  console.log("🎬 [Fanvue Image Sync] Starting image upload sequence...");
  console.log(`- Target Asset URL: ${params.mediaUrl}`);

  // 1. Download the raw file bytes from your Supabase storage URL
  const response = await fetch(params.mediaUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image from storage link. Status: ${response.status}`);
  }
  const imageBlob = await response.blob();
  console.log(`📸 Image downloaded from Supabase. Size: ${imageBlob.size} bytes. Type: ${imageBlob.type}`);

  // 2. Wrap the binary data into standard multipart/form-data
  const formData = new FormData();
  formData.append("file", imageBlob, `post-image-${Date.now()}.png`);

  // 3. Upload the actual file data to Fanvue's media vault endpoint
  console.log("📤 Sending image binary to Fanvue Vault...");
  const uploadRes = await fetch(`${FANVUE_API_BASE}/v1/posts/media`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "X-Fanvue-API-Version": "2025-06-26"
    },
    body: formData,
  });

  if (!uploadRes.ok) {
    const errorLog = await uploadRes.text();
    console.error("❌ Fanvue media vault upload failed:", errorLog);
    throw new Error(`Fanvue media vault rejected the file payload: ${errorLog}`);
  }

  const uploadData = await uploadRes.json();
  const mediaId = uploadData.id ?? uploadData.mediaId ?? uploadData.uuid;
  console.log(`✅ Image safely stored in Vault! Asset Identifier: ${mediaId}`);

  if (!mediaId) {
    throw new Error("Upload completed, but Fanvue did not return a valid asset media ID token.");
  }

  // 4. Attach that newly uploaded media ID directly to a public timeline post
  console.log("📝 Creating the timeline post with your image...");
  const postRes = await fetch(`${FANVUE_API_BASE}/v1/posts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
      "X-Fanvue-API-Version": "2025-06-26"
    },
    body: JSON.stringify({
      text: params.caption,      
      mediaUuids: [mediaId],     
      visibility: "public",      
      status: "published"
    }),
  });

  if (!postRes.ok) {
    const errorLog = await postRes.text();
    console.error("❌ Timeline post creation failed:", errorLog);
    throw new Error(`Fanvue post generation failed: ${errorLog}`);
  }

  const postData = await postRes.json();
  console.log("🎉 Post successfully went live on profile feed!", postData);
  
  return postData.id ?? postData.postId ?? `fv_${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Route Boundaries & Structural Types
// ---------------------------------------------------------------------------

function RouteErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  console.error("[schedule route error]", error);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
      <h2 className="font-display text-lg font-semibold">Scheduling couldn't load</h2>
      <p className="max-w-md text-sm text-muted-foreground">{error?.message ?? "Unknown error"}</p>
      <div className="flex gap-2">
        <button onClick={() => reset()} className="rounded-md border border-input bg-background px-4 py-2 text-sm">Try again</button>
        <a href="/" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Go home</a>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/schedule")({
  head: () => ({
    meta: [
      { title: "Scheduling — Lila Studio" },
      {
        name: "description",
        content: "Schedule, queue and publish approved image assets to connected Fanvue profiles.",
      },
    ],
  }),
  component: SchedulePage,
  errorComponent: RouteErrorBoundary,
});

type PublishStatus = "scheduled" | "publishing" | "published" | "failed";
type QueueStatus = "waiting" | "ready" | "publishing" | "published" | "failed";
type ContentType = "image" | "video";

type ConnectedAccount = {
  id: string;
  platform: "fanvue";
  name: string;
  handle: string;
  status: "connected" | "disconnected" | "error";
  accessToken?: string;
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
  mediaUrl: string;
  referenceImage?: string;
  accountId: string;
  scheduledAt: string;
  status: PublishStatus;
  queueStatus: QueueStatus;
  autoPublish: boolean;
  notes?: string;
  externalPostId?: string;
  publishedAt?: string;
  reviewStatus: "approved";
  settings: { samplingSteps: number };
  scenePrompts: string[];
  negativePrompt: string;
  history: HistoryEvent[];
};

const EMPTY_SCHEDULE_ITEMS: ScheduledItem[] = [];
const EMPTY_CONNECTED_ACCOUNTS: ConnectedAccount[] = [];
const PLACEHOLDER = "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&q=80";

// ---------------------------------------------------------------------------
// Supabase Connectors
// ---------------------------------------------------------------------------

async function fetchAccounts(): Promise<ConnectedAccount[]> {
  const { data, error } = await supabase
    .from("connected_accounts")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((a: any) => ({
    id: a.id,
    platform: "fanvue",
    name: a.account_name,
    handle: a.external_account_id ?? "—",
    status: a.connection_status === "connected" ? "connected" : a.connection_status === "error" ? "error" : "disconnected",
    accessToken: a.access_token ?? undefined,
  }));
}

async function fetchSchedules(): Promise<ScheduledItem[]> {
  const { data: rows, error } = await supabase
    .from("schedules")
    .select("*")
    .order("publish_time", { ascending: true });
  if (error) throw error;

  const imageIds = (rows ?? []).filter((r: any) => r.content_type === "image").map((r: any) => r.content_id);
  const videoIds = (rows ?? []).filter((r: any) => r.content_type === "video").map((r: any) => r.content_id);

  const [imgRes, vidRes, charRes] = await Promise.all([
    imageIds.length ? supabase.from("images").select("id, image_url, prompt, character_id, connected_account_id, published_at, external_post_id, publish_status").in("id", imageIds) : Promise.resolve({ data: [] }),
    videoIds.length ? supabase.from("videos").select("id, video_url, prompt, scene_prompts, character_id, connected_account_id, published_at, external_post_id, publish_status").in("id", videoIds) : Promise.resolve({ data: [] }),
    supabase.from("characters").select("id, name, reference_image_url"),
  ]);

  const imgMap = new Map((imgRes.data ?? []).map((i: any) => [i.id, i]));
  const vidMap = new Map((vidRes.data ?? []).map((v: any) => [v.id, v]));
  const charMap = new Map((charRes.data ?? []).map((c: any) => [c.id, c]));

  return (rows ?? []).map((r: any): ScheduledItem => {
    const isVideo = r.content_type === "video";
    const src: any = isVideo ? vidMap.get(r.content_id) : imgMap.get(r.content_id);
    const char: any = src?.character_id ? charMap.get(src.character_id) : null;
    const scenes: string[] = isVideo && Array.isArray(src?.scene_prompts) ? src.scene_prompts : src?.prompt ? [src.prompt] : [];
    const media = isVideo ? src?.video_url : src?.image_url;
    const thumb = char?.reference_image_url || media || PLACEHOLDER;
    const status: PublishStatus = r.status === "published" ? "published" : r.status === "failed" ? "failed" : r.status === "publishing" || src?.publish_status === "publishing" ? "publishing" : "scheduled";
    const queueStatus: QueueStatus = status === "published" ? "published" : status === "failed" ? "failed" : status === "publishing" ? "publishing" : new Date(r.publish_time) <= new Date() ? "ready" : "waiting";
    
    return {
      id: r.id,
      contentName: `${char?.name ?? "Lila"} — ${(scenes[0] ?? "Untitled").slice(0, 40)}`,
      type: r.content_type,
      character: char?.name ?? "Lila",
      thumbnail: thumb,
      mediaUrl: media || "",
      referenceImage: char?.reference_image_url ?? undefined,
      accountId: src?.connected_account_id ?? "",
      scheduledAt: r.publish_time,
      status,
      queueStatus,
      autoPublish: true,
      reviewStatus: "approved",
      externalPostId: src?.external_post_id ?? undefined,
      publishedAt: src?.published_at ?? undefined,
      settings: { samplingSteps: 29 },
      scenePrompts: scenes,
      negativePrompt: "low quality, blurry, distorted face",
      history: [
        { at: r.created_at, label: `Scheduled for ${new Date(r.publish_time).toLocaleString()}`, kind: "scheduled" },
        ...(src?.published_at ? [{ at: src.published_at, label: "Published", kind: "published" as const }] : []),
      ],
    };
  });
}

// ---------------------------------------------------------------------------
// Design System Badges
// ---------------------------------------------------------------------------

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

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
const fmtDateTime = (iso: string) => `${fmtDate(iso)} · ${fmtTime(iso)}`;
const isSameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function StatusBadge({ status }: { status: PublishStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider", statusStyle[status])}>
      {status === "publishing" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      {status}
    </span>
  );
}

function QueueBadge({ status }: { status: QueueStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider", queueStatusStyle[status])}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Core Component Definition
// ---------------------------------------------------------------------------

function SchedulePage() {
  const queryClient = useQueryClient();
  const { data: scheduleData = EMPTY_SCHEDULE_ITEMS } = useQuery({ queryKey: ["schedules"], queryFn: fetchSchedules, staleTime: 10_000 });
  const { data: accounts = EMPTY_CONNECTED_ACCOUNTS, refetch: refetchAccounts } = useQuery({ queryKey: ["connected-accounts"], queryFn: fetchAccounts, staleTime: 60_000 });
  const [items, setItems] = useState<ScheduledItem[]>([]);
  
  useEffect(() => setItems(scheduleData), [scheduleData]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) return;

    window.history.replaceState({}, "", window.location.pathname);
    toast.loading("Connecting Fanvue account…", { id: "fanvue-connect" });
    
    exchangeFanvueCode(code)
      .then(() => {
        toast.success("Fanvue account connected!", { id: "fanvue-connect" });
        refetchAccounts();
      })
      .catch((err) => {
        toast.error(err.message ?? "Failed to connect account", { id: "fanvue-connect" });
      });
  }, [refetchAccounts]);

  const characters = useMemo(() => Array.from(new Set(items.map((i) => i.character))), [items]);
  const [tab, setTab] = useState("calendar");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | PublishStatus>("all");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [characterFilter, setCharacterFilter] = useState<string>("all");
  const [rangeFilter, setRangeFilter] = useState<"all" | "today" | "week" | "month">("all");
  const [selected, setSelected] = useState<ScheduledItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);

  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return d;
  });

  const getAccount = (id: string) => accounts.find((a) => a.id === id);

  const stats = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    return {
      scheduled: items.filter((i) => i.status === "scheduled").length,
      todayCount: items.filter((i) => i.status === "scheduled" && isSameDay(new Date(i.scheduledAt), now)).length,
      weekPublished: items.filter((i) => i.status === "published" && i.publishedAt && new Date(i.publishedAt) >= weekAgo).length,
      failed: items.filter((i) => i.status === "failed").length,
      connectedAccounts: accounts.filter((a) => a.status === "connected").length,
    };
  }, [items, accounts]);

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
        if (rangeFilter === "month" && (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear())) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const acc = getAccount(i.accountId);
        const hay = [i.contentName, i.character, acc?.name, acc?.handle, i.externalPostId].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, statusFilter, accountFilter, characterFilter, rangeFilter, search]);

  const updateItem = (id: string, patch: Partial<ScheduledItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const removeItem = async (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setSelected(null);
    try {
      const { error } = await supabase.from("schedules").delete().eq("id", id);
      if (error) throw error;
      toast.success("Schedule removed");
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed to remove"); }
  };

  const retryPublish = async (id: string) => {
    updateItem(id, {
      status: "scheduled",
      queueStatus: "ready",
      history: [...(items.find((i) => i.id === id)?.history ?? []), { at: new Date().toISOString(), label: "Retry queued", kind: "retried" }],
    });
    try {
      await scheduleService.update(id, { status: "scheduled" });
      toast.success("Queued for retry");
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed to retry"); }
  };

  const publishNow = async (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;

    const account = accounts.find((a) => a.id === item.accountId);
    if (!account?.accessToken) {
      toast.error("No Fanvue account connected for this item.", { action: { label: "Connect", onClick: () => setAccountsOpen(true) } });
      return;
    }

    updateItem(id, { status: "publishing", queueStatus: "publishing" });

    try {
      const externalPostId = await publishToFanvue({
        accessToken: account.accessToken,
        mediaUrl: item.mediaUrl,
        mediaType: item.type,
        caption: item.scenePrompts[0] ?? item.contentName,
      });

      const now = new Date().toISOString();
      const table = item.type === "image" ? "images" : "videos";
      const { data: sRow } = await supabase.from("schedules").select("content_id").eq("id", id).single();

      if (sRow?.content_id) {
        await supabase.from(table).update({ publish_status: "published", published_at: now, external_post_id: externalPostId }).eq("id", sRow.content_id);
      }

      await scheduleService.update(id, { status: "published" });
      updateItem(id, {
        status: "published",
        queueStatus: "published",
        externalPostId,
        publishedAt: now,
        history: [...item.history, { at: now, label: `Published to Fanvue (${account.name})`, kind: "published" }],
      });

      toast.success(`Published to Fanvue @${account.handle}!`);
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
    } catch (e: any) {
      updateItem(id, { status: "failed", queueStatus: "failed" });
      try { await scheduleService.update(id, { status: "failed" }); } catch {}
      toast.error(`Publish failed: ${e?.message ?? "Unknown error"}`);
    }
  };

  const [dragId, setDragId] = useState<string | null>(null);

  const onDropOnDay = async (day: Date) => {
    if (!dragId) return;
    const item = items.find((i) => i.id === dragId);
    if (!item) return;
    const oldD = new Date(item.scheduledAt);
    const newD = new Date(day);
    newD.setHours(oldD.getHours(), oldD.getMinutes(), 0, 0);
    const iso = newD.toISOString();
    
    updateItem(dragId, {
      scheduledAt: iso,
      history: [...item.history, { at: new Date().toISOString(), label: `Rescheduled to ${fmtDateTime(iso)}`, kind: "scheduled" }],
    });
    
    try {
      await scheduleService.update(dragId, { publish_time: iso });
      toast.success("Schedule updated");
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed to update"); }
    setDragId(null);
  };

  const connectedCount = accounts.filter((a) => a.status === "connected").length;

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        <main className="flex-1 overflow-y-auto bg-background">
          <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Link to="/" className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
                  <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
                </Link>
                <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">Scheduling</h1>
                <p className="mt-1 text-sm text-muted-foreground">Plan and direct automated binary image streams directly to your Fanvue layout feed.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setAccountsOpen(true)}>
                  <Plug className="h-4 w-4" />
                  {connectedCount > 0 ? <span>Accounts <span className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-success text-[10px] font-bold text-white">{connectedCount}</span></span> : "Connect Fanvue"}
                </Button>
                <Button size="sm" className="gap-2" onClick={() => setCreateOpen(true)}><CalendarPlus className="h-4 w-4" /> Schedule content</Button>
              </div>
            </div>

            {connectedCount === 0 && (
              <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warning" />
                <p className="flex-1 text-sm text-foreground">No verification keys found. Sync your profile to start routing media nodes.</p>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAccountsOpen(true)}><ExternalLink className="h-3.5 w-3.5" /> Connect now</Button>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <DashboardCard label="Scheduled posts" value={stats.scheduled} icon={CalendarClock} accent="primary" hint="Awaiting execution" />
              <DashboardCard label="Publishing today" value={stats.todayCount} icon={Clock} accent="chart-2" hint="Next 24 hours" />
              <DashboardCard label="Published this week" value={stats.weekPublished} icon={CheckCircle2} accent="chart-3" delta={12} />
              <DashboardCard label="Failed publications" value={stats.failed} icon={AlertTriangle} accent="chart-5" hint={stats.failed ? "Action required" : "All clear"} />
              <DashboardCard label="Connected profiles" value={`${stats.connectedAccounts}/${accounts.length}`} icon={Link2} accent="chart-4" hint="Fanvue Protocol" />
            </div>

            <Card className="border-border/60 bg-card">
              <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search character, layout nodes or post logs..." className="pl-9" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as never)}>
                    <SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="scheduled">Scheduled</SelectItem>
                      <SelectItem value="publishing">Publishing</SelectItem>
                      <SelectItem value="published">Published</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={accountFilter} onValueChange={setAccountFilter}>
                    <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="Account" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All profiles</SelectItem>
                      {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="calendar">Calendar layout</TabsTrigger>
                <TabsTrigger value="queue">Active Queue</TabsTrigger>
                <TabsTrigger value="history">Historical logs</TabsTrigger>
              </TabsList>
              <TabsContent value="calendar" className="mt-4">
                <CalendarView weekStart={weekStart} setWeekStart={setWeekStart} items={filteredItems} getAccount={getAccount} onOpen={setSelected} onDragStart={setDragId} onDropOnDay={onDropOnDay} onSchedule={() => setCreateOpen(true)} />
              </TabsContent>
              <TabsContent value="queue" className="mt-4">
                <QueueView items={filteredItems.filter((i) => ["scheduled", "publishing", "failed"].includes(i.status))} getAccount={getAccount} onOpen={setSelected} onPause={(id) => updateItem(id, { autoPublish: false })} onCancel={removeItem} onPublishNow={publishNow} onRetry={retryPublish} onSchedule={() => setCreateOpen(true)} />
              </TabsContent>
              <TabsContent value="history" className="mt-4">
                <HistoryView items={filteredItems.filter((i) => ["published", "failed"].includes(i.status))} getAccount={getAccount} onOpen={setSelected} onRetry={retryPublish} />
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </SidebarInset>

      <DetailSheet item={selected} onClose={() => setSelected(null)} getAccount={getAccount} onRetry={retryPublish} onPublishNow={publishNow} onRemove={removeItem} />
      <CreateScheduleDialog open={createOpen} onOpenChange={setCreateOpen} />
      <AccountsDialog open={accountsOpen} onOpenChange={setAccountsOpen} accounts={accounts} onRefresh={refetchAccounts} />
    </SidebarProvider>
  );
}

// ---------------------------------------------------------------------------
// Inline UI Views (Calendar, Queue, History)
// ---------------------------------------------------------------------------

function CalendarView({ weekStart, setWeekStart, items, getAccount, onOpen, onDragStart, onDropOnDay, onSchedule }: any) {
  const days = Array.from({ length: 7 }).map((_, idx) => { const d = new Date(weekStart); d.setDate(d.getDate() + idx); return d; });
  const itemsByDay = (day: Date) => items.filter((i: any) => isSameDay(new Date(i.scheduledAt), day));

  return (
    <div className="grid grid-cols-1 gap-2 lg:grid-cols-7">
      {days.map((day) => {
        const dayItems = itemsByDay(day);
        return (
          <div key={day.toISOString()} onDragOver={(e) => e.preventDefault()} onDrop={() => onDropOnDay(day)} className="min-h-[250px] rounded-xl border bg-card p-3">
            <p className="text-xs font-bold text-muted-foreground">{day.toLocaleDateString([], { weekday: "short" })} {day.getDate()}</p>
            <div className="mt-3 space-y-2">
              {dayItems.map((i: any) => (
                <div key={i.id} draggable onDragStart={() => onDragStart(i.id)} onClick={() => onOpen(i)} className="cursor-pointer rounded-lg border p-2 bg-background/50 hover:border-primary">
                  <img src={i.thumbnail} className="h-16 w-full rounded object-cover" alt="" />
                  <p className="mt-1 text-xs font-medium truncate">{i.character}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function QueueView({ items, getAccount, onOpen, onCancel, onPublishNow, onRetry, onSchedule }: any) {
  if (!items.length) return <EmptyState onSchedule={onSchedule} />;
  return (
    <div className="space-y-2">
      {items.map((i: any) => (
        <Card key={i.id} className="p-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={i.thumbnail} className="h-12 w-16 rounded object-cover" alt="" />
            <div>
              <p className="text-sm font-semibold">{i.contentName}</p>
              <p className="text-xs text-muted-foreground">{fmtDateTime(i.scheduledAt)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <QueueBadge status={i.queueStatus} />
            <Button size="sm" onClick={() => onPublishNow(i.id)} disabled={i.status === "publishing"}>Publish Now</Button>
            <Button size="icon" variant="ghost" className="text-destructive" onClick={() => onCancel(i.id)}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function HistoryView({ items, getAccount, onOpen }: any) {
  if (!items.length) return <div className="text-center p-10 text-muted-foreground">No historical logs found.</div>;
  return (
    <div className="space-y-2">
      {items.map((i: any) => (
        <Card key={i.id} className="p-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={i.thumbnail} className="h-12 w-16 rounded object-cover" alt="" />
            <div>
              <p className="text-sm font-semibold">{i.contentName}</p>
              <p className="text-xs text-muted-foreground">Post Key: <span className="font-mono text-[11px]">{i.externalPostId ?? "N/A"}</span></p>
            </div>
          </div>
          <StatusBadge status={i.status} />
        </Card>
      ))}
    </div>
  );
}

function DetailSheet({ item, onClose, onPublishNow, onRemove }: any) {
  return (
    <Sheet open={!!item} onOpenChange={onClose}>
      <SheetContent>
        {item && (
          <div className="space-y-4 pt-4">
            <SheetHeader>
              <SheetTitle>{item.contentName}</SheetTitle>
              <SheetDescription>{item.character} · Image File Pipeline</SheetDescription>
            </SheetHeader>
            <img src={item.mediaUrl || item.thumbnail} className="w-full rounded-lg object-cover aspect-video" alt="" />
            <div className="flex gap-2">
              <Button onClick={() => onPublishNow(item.id)} className="w-full">Fire Payload Node</Button>
              <Button variant="outline" className="text-destructive" onClick={() => onRemove(item.id)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CreateScheduleDialog({ open, onOpenChange }: any) {
  const queryClient = useQueryClient();
  const { data: assets = [] } = useQuery({ queryKey: ["approved-assets"], queryFn: fetchApprovedAssets, enabled: open });
  const { data: accounts = [] } = useQuery({ queryKey: ["connected-accounts"], queryFn: fetchAccounts, enabled: open });

  const [assetIdx, setAssetIdx] = useState("0");
  const [accId, setAccId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("12:00");

  useEffect(() => { if (accounts.length) setAccId(accounts[0].id); }, [accounts]);

  const save = async () => {
    const asset = assets[Number(assetIdx)];
    if (!asset || !accId) return;
    try {
      const { data: u } = await supabase.auth.getUser();
      await scheduleService.create({
        content_type: asset.type,
        content_id: asset.id,
        publish_time: new Date(`${date}T${time}:00`).toISOString(),
        platform: "Fanvue",
        status: "scheduled",
        created_by: u.user?.id,
      } as any);
      await supabase.from(asset.type === "image" ? "images" : "videos").update({ connected_account_id: accId }).eq("id", asset.id);
      toast.success("Scheduled successfully");
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
      onOpenChange(false);
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Schedule Stream Node</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Label>Approved Node</Label>
          <Select value={assetIdx} onValueChange={setAssetIdx}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{assets.map((a, idx) => <SelectItem key={a.id} value={String(idx)}>{a.name}</SelectItem>)}</SelectContent>
          </Select>
          <Label>Target Account</Label>
          <Select value={accId} onValueChange={setAccId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
          </Select>
          <div className="flex gap-2">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        <DialogFooter><Button onClick={save}>Enlist Schedule</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccountsDialog({ open, onOpenChange, accounts, onRefresh }: any) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Linked Profiles</DialogTitle></DialogHeader>
        <div className="space-y-2">
          {accounts.map((a: any) => (
            <div key={a.id} className="flex justify-between items-center border p-2 rounded">
              <div><p className="text-sm font-bold">{a.name}</p><p className="text-xs text-muted-foreground">@{a.handle}</p></div>
              <Badge variant={a.status === "connected" ? "default" : "destructive"}>{a.status}</Badge>
            </div>
          ))}
          <Button className="w-full mt-2" onClick={startFanvueOAuth}>Authorize New Profile Pair</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({ onSchedule }: { onSchedule: () => void }) {
  return (
    <div className="text-center py-8">
      <Inbox className="mx-auto h-8 w-8 text-muted-foreground/60" />
      <p className="mt-2 text-sm font-medium">No files listed in this workspace context.</p>
      <Button size="sm" className="mt-3" onClick={onSchedule}>Schedule Asset Node</Button>
    </div>
  );
}
