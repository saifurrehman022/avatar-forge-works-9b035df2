import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardCheck,
  CheckCircle2,
  XCircle,
  Search,
  Image as ImageIcon,
  Play,
  Sparkles,
  Filter,
  Inbox,
  Film,
  CalendarPlus,
  Library,
  DollarSign,
  Tag,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { AppHeader } from "@/components/dashboard/app-header";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { cn } from "@/lib/utils";

function RouteErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  console.error("[review route error]", error);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
      <h2 className="font-display text-lg font-semibold">Review queue couldn't load</h2>
      <p className="max-w-md text-sm text-muted-foreground">{error?.message ?? "Unknown error"}</p>
      <div className="flex gap-2">
        <button onClick={() => reset()} className="rounded-md border border-input bg-background px-4 py-2 text-sm">Try again</button>
        <a href="/" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Go home</a>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/review")({
  head: () => ({
    meta: [
      { title: "Review Queue — Lila Studio" },
      { name: "description", content: "Moderate, approve and reject AI-generated content before scheduling and publishing." },
    ],
  }),
  component: ReviewPage,
  errorComponent: RouteErrorBoundary,
});

// ---------- Types ----------

type ReviewStatus = "pending" | "approved" | "rejected" | "scheduled" | "published";
type ContentType = "image" | "video";
type PostType = "normal" | "ppv";

const PPV_PRICE_PRESETS = [5, 15, 20];

type HistoryEvent = {
  at: string;
  label: string;
  kind: "generated" | "queued" | "approved" | "rejected" | "regenerated" | "scheduled" | "published";
  by?: string;
};

// Post meta is kept ENTIRELY client-side — no Supabase columns required.
type PostMeta = {
  postType: PostType;
  price: number;
  caption: string;
};

type ReviewItem = {
  id: string;           // review_queue row id
  contentId: string;    // images/videos row id
  type: ContentType;
  character: string;
  thumbnail: string;
  preview: string;
  referenceImage: string;
  createdAt: string;
  status: ReviewStatus;
  jobId: string;
  prompt: string;        // original prompt, used only as caption fallback
  postMeta: PostMeta;     // local-only
  notes?: string;
  history: HistoryEvent[];
};

const EMPTY_REVIEW_ITEMS: ReviewItem[] = [];
const PLACEHOLDER_IMG = "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800&q=80";

// ---------- Local-only post-meta storage ----------
// Keyed by contentId. Persisted to localStorage so it survives refresh,
// but never touches Supabase — avoids needing new DB columns.

const POST_META_STORAGE_KEY = "lila_review_post_meta";

function loadPostMetaMap(): Record<string, PostMeta> {
  try {
    if (typeof window === "undefined") return {};
    const raw = localStorage.getItem(POST_META_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function savePostMetaMap(map: Record<string, PostMeta>) {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(POST_META_STORAGE_KEY, JSON.stringify(map));
  } catch { /* ignore quota errors */ }
}

function defaultPostMeta(caption: string): PostMeta {
  return { postType: "normal", price: PPV_PRICE_PRESETS[0], caption };
}

// ---------- Data Loading ----------
// Only touches existing columns — no post_type / price / caption in the DB.

async function fetchQueue(): Promise<ReviewItem[]> {
  const [imgRes, vidRes, queueRes, charRes] = await Promise.all([
    supabase
      .from("images")
      .select("id, image_url, prompt, character_id, created_at, status, publish_status")
      .order("created_at", { ascending: false }),
    supabase
      .from("videos")
      .select("id, video_url, prompt, scene_prompts, character_id, created_at, status, publish_status")
      .order("created_at", { ascending: false }),
    supabase.from("review_queue").select("*"),
    supabase.from("characters").select("id, name, reference_image_url"),
  ]);

  const charMap = new Map((charRes.data ?? []).map((c: any) => [c.id, c]));

  const queueByContentId = new Map<string, any>();
  for (const row of queueRes.data ?? []) {
    queueByContentId.set(row.content_id, row);
  }

  function deriveStatus(qRow: any, contentRow: any): ReviewStatus {
    if (qRow?.status === "scheduled") return "scheduled";
    if (qRow?.status === "approved")  return "approved";
    if (qRow?.status === "rejected")  return "rejected";
    if (contentRow.publish_status === "scheduled") return "scheduled";
    if (contentRow.status === "approved") return "approved";
    if (contentRow.status === "rejected") return "rejected";
    return "pending";
  }

  const items: ReviewItem[] = [];

  // --- Images ---
  for (const img of imgRes.data ?? []) {
    const char: any = img.character_id ? charMap.get(img.character_id) : null;
    const qRow = queueByContentId.get(img.id);
    const status = deriveStatus(qRow, img);
    const media = img.image_url || PLACEHOLDER_IMG;
    items.push({
      id: qRow?.id ?? `img-${img.id}`,
      contentId: img.id,
      type: "image",
      character: char?.name ?? "Lila",
      thumbnail: media,
      preview: media,
      referenceImage: char?.reference_image_url || PLACEHOLDER_IMG,
      createdAt: img.created_at,
      status,
      jobId: img.id,
      prompt: img.prompt ?? "",
      postMeta: defaultPostMeta(img.prompt ?? ""), // overridden later from localStorage
      notes: qRow?.notes ?? undefined,
      history: [
        { at: img.created_at, label: "Generated", kind: "generated" as const },
        ...(qRow ? [{ at: qRow.created_at, label: "In review queue", kind: "queued" as const }] : []),
        ...(qRow?.reviewed_at ? [{
          at: qRow.reviewed_at,
          label: qRow.status === "approved" ? "Approved" : qRow.status === "scheduled" ? "Scheduled" : "Rejected",
          kind: qRow.status as "approved" | "rejected" | "scheduled",
        } as HistoryEvent] : []),
      ],
    });
  }

  // --- Videos ---
  for (const vid of vidRes.data ?? []) {
    const char: any = vid.character_id ? charMap.get(vid.character_id) : null;
    const qRow = queueByContentId.get(vid.id);
    const status = deriveStatus(qRow, vid);
    const media = vid.video_url || PLACEHOLDER_IMG;
    const fallbackCaption: string =
      vid.prompt ??
      (Array.isArray(vid.scene_prompts) && vid.scene_prompts.length ? String(vid.scene_prompts[0]) : "");
    items.push({
      id: qRow?.id ?? `vid-${vid.id}`,
      contentId: vid.id,
      type: "video",
      character: char?.name ?? "Lila",
      thumbnail: char?.reference_image_url || media,
      preview: media,
      referenceImage: char?.reference_image_url || PLACEHOLDER_IMG,
      createdAt: vid.created_at,
      status,
      jobId: vid.id,
      prompt: fallbackCaption,
      postMeta: defaultPostMeta(fallbackCaption),
      notes: qRow?.notes ?? undefined,
      history: [
        { at: vid.created_at, label: "Generated", kind: "generated" as const },
        ...(qRow ? [{ at: qRow.created_at, label: "In review queue", kind: "queued" as const }] : []),
        ...(qRow?.reviewed_at ? [{
          at: qRow.reviewed_at,
          label: qRow.status === "approved" ? "Approved" : qRow.status === "scheduled" ? "Scheduled" : "Rejected",
          kind: qRow.status as "approved" | "rejected" | "scheduled",
        } as HistoryEvent] : []),
      ],
    });
  }

  return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// ---------- Helpers ----------

const STATUS_STYLE: Record<ReviewStatus, string> = {
  pending: "bg-chart-4/15 text-chart-4 border-chart-4/30",
  approved: "bg-success/15 text-success border-success/30",
  rejected: "bg-destructive/15 text-destructive border-destructive/30",
  scheduled: "bg-primary/15 text-primary border-primary/30",
  published: "bg-chart-2/15 text-chart-2 border-chart-2/30",
};

const STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: "Pending Review",
  approved: "Approved",
  rejected: "Rejected",
  scheduled: "Scheduled",
  published: "Published",
};

function StatusBadge({ status }: { status: ReviewStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider", STATUS_STYLE[status])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {STATUS_LABEL[status]}
    </span>
  );
}

function PostTypeBadge({ postMeta }: { postMeta: PostMeta }) {
  if (postMeta.postType === "ppv") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-chart-4/30 bg-chart-4/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-chart-4">
        <DollarSign className="h-3 w-3" /> PPV · ${postMeta.price}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      <Tag className="h-3 w-3" /> Normal
    </span>
  );
}

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

// ---------- Schedule Dialog ----------
// Only writes existing columns to Supabase. Post meta (type/price/caption) is
// shown for confirmation but NOT persisted server-side — purely informational.

type ConnectedAccount = { id: string; name: string; status: string };

function ScheduleDialog({ item, onClose, onScheduled }: {
  item: ReviewItem | null;
  onClose: () => void;
  onScheduled: (id: string) => void;
}) {
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [time, setTime] = useState("18:00");
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!item) return;
    supabase.from("connected_accounts").select("id, account_name, connection_status").then(({ data }) => {
      const mapped = (data ?? []).map((a: any) => ({ id: a.id, name: a.account_name, status: a.connection_status }));
      setAccounts(mapped);
      if (mapped.length) setAccountId(mapped[0].id);
    });
  }, [item]);

  const submit = async () => {
    if (!item) return;
    setLoading(true);
    try {
      const iso = new Date(`${date}T${time}:00`).toISOString();
      const { data: userRes } = await supabase.auth.getUser();

      // Only existing columns — no post_type/price/caption written here.
      const { error: schedErr } = await supabase.from("schedules").insert({
        content_type: item.type,
        content_id: item.contentId,
        publish_time: iso,
        platform: "Fanvue",
        status: "scheduled",
        created_by: userRes.user?.id ?? null,
      });
      if (schedErr) throw schedErr;

      const table = item.type === "image" ? "images" : "videos";
      await supabase.from(table).update({
        publish_status: "scheduled",
        ...(accountId ? { connected_account_id: accountId } : {}),
      }).eq("id", item.contentId);

      await supabase.from("review_queue").update({
        status: "scheduled",
        reviewed_at: new Date().toISOString(),
      }).eq("id", item.id);

      toast.success(
        `Scheduled${item.postMeta.postType === "ppv" ? ` as PPV ($${item.postMeta.price})` : ""} for ${new Date(iso).toLocaleString()}`,
        { action: { label: "View Library", onClick: () => window.location.href = "/library" } },
      );
      onScheduled(item.id);
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to schedule");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Schedule content</DialogTitle>
          <DialogDescription>Pick a date, time and Fanvue account to publish to.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {item && (
            <div className="space-y-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Post type</span>
                <PostTypeBadge postMeta={item.postMeta} />
              </div>
              {item.postMeta.caption && (
                <p className="line-clamp-2 text-xs text-muted-foreground">"{item.postMeta.caption}"</p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
            </div>
            <div className="space-y-1.5">
              <Label>Time</Label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Publishing account</Label>
            {accounts.length === 0 ? (
              <p className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">No Fanvue account connected — add one in Settings.</p>
            ) : (
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id} disabled={a.status !== "connected"}>
                      {a.name} {a.status !== "connected" ? "· offline" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={loading} className="gap-2">
            <CalendarPlus className="h-4 w-4" />
            {loading ? "Scheduling…" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Page Component ----------

function ReviewPage() {
  const queryClient = useQueryClient();
  const { data: queueItems = EMPTY_REVIEW_ITEMS, isLoading } = useQuery({
    queryKey: ["review-queue"],
    queryFn: fetchQueue,
    staleTime: 10_000,
  });

  const [items, setItems] = useState<ReviewItem[]>([]);

  // Merge fetched items with locally-stored post meta whenever the query refreshes.
  useEffect(() => {
    const metaMap = loadPostMetaMap();
    setItems(
      queueItems.map((i) => ({
        ...i,
        postMeta: metaMap[i.contentId] ?? i.postMeta,
      })),
    );
  }, [queueItems]);

  useEffect(() => {
    const ch = supabase
      .channel("review-queue-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "review_queue" }, () =>
        queryClient.invalidateQueries({ queryKey: ["review-queue"] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "images" }, () =>
        queryClient.invalidateQueries({ queryKey: ["review-queue"] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "videos" }, () =>
        queryClient.invalidateQueries({ queryKey: ["review-queue"] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [queryClient]);

  const [selected, setSelected] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [scheduleItem, setScheduleItem] = useState<ReviewItem | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | "all">("all");
  const [typeFilter, setTypeFilter] = useState<ContentType | "all">("all");
  const [noteDraft, setNoteDraft] = useState("");

  // Draft post-meta for the open item — this is the SOURCE OF TRUTH while the
  // detail sheet is open. Both "Save post details" and "Schedule" read from
  // these draft values, never from the (possibly stale) items array.
  const [draftPostType, setDraftPostType] = useState<PostType>("normal");
  const [draftPrice, setDraftPrice] = useState<number>(PPV_PRICE_PRESETS[0]);
  const [draftCaption, setDraftCaption] = useState<string>("");

  const openItem = items.find((i) => i.id === openId) ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (typeFilter !== "all" && i.type !== typeFilter) return false;
      if (!q) return true;
      return (
        i.character.toLowerCase().includes(q) ||
        i.jobId.toLowerCase().includes(q) ||
        i.postMeta.caption.toLowerCase().includes(q)
      );
    });
  }, [items, search, statusFilter, typeFilter]);

  const stats = useMemo(() => ({
    total: items.length,
    pending: items.filter((i) => i.status === "pending").length,
    approved: items.filter((i) => i.status === "approved").length,
    scheduled: items.filter((i) => i.status === "scheduled").length,
    rejected: items.filter((i) => i.status === "rejected").length,
  }), [items]);

  // ---- Core actions (unchanged Supabase calls — only existing columns) ----

  const updateLocalStatus = (id: string, status: ReviewStatus, evt: HistoryEvent) =>
    setItems((arr) => arr.map((i) => i.id === id ? { ...i, status, history: [...i.history, evt] } : i));

  const ensureQueueRow = async (item: ReviewItem): Promise<string> => {
    const hasRealId = !item.id.startsWith("img-") && !item.id.startsWith("vid-");
    if (hasRealId) return item.id;
    const { data, error } = await supabase.from("review_queue").insert({
      content_type: item.type,
      content_id: item.contentId,
      status: "pending",
      reviewer_id: null,
      reviewed_at: null,
      notes: null,
    }).select("id").single();
    if (error) throw error;
    setItems((arr) => arr.map((i) => i.id === item.id ? { ...i, id: data.id } : i));
    return data.id;
  };

  const approve = async (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const now = new Date().toISOString();

    updateLocalStatus(id, "approved", { at: now, label: "Approved", kind: "approved" });

    try {
      const queueId = await ensureQueueRow(item);

      const { error: rqErr } = await supabase.from("review_queue").update({
        status: "approved",
        reviewed_at: now,
      }).eq("id", queueId);
      if (rqErr) throw rqErr;

      const table = item.type === "image" ? "images" : "videos";
      const { error: contentErr } = await supabase.from(table).update({ status: "approved" }).eq("id", item.contentId);
      if (contentErr) throw contentErr;

      toast.success("Content approved — ready to schedule", {
        action: { label: "Schedule now", onClick: () => setScheduleItem(item) },
        duration: 6000,
      });
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["library"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to approve");
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
    }
  };

  const reject = async (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const now = new Date().toISOString();

    updateLocalStatus(id, "rejected", { at: now, label: "Rejected", kind: "rejected" });

    try {
      const queueId = await ensureQueueRow(item);

      const { error: rqErr } = await supabase.from("review_queue").update({
        status: "rejected",
        reviewed_at: now,
      }).eq("id", queueId);
      if (rqErr) throw rqErr;

      const table = item.type === "image" ? "images" : "videos";
      await supabase.from(table).update({ status: "rejected" }).eq("id", item.contentId);

      toast.error("Content rejected");
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["library"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to reject");
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
    }
  };

  const saveNote = async (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setItems((arr) => arr.map((i) => (i.id === id ? { ...i, notes: noteDraft } : i)));
    try {
      const queueId = await ensureQueueRow(item);
      const { error } = await supabase.from("review_queue").update({ notes: noteDraft }).eq("id", queueId);
      if (error) throw error;
      toast.success("Reviewer note saved");
    } catch (e: any) { toast.error(e?.message ?? "Failed to save note"); }
  };

  // Builds a fresh PostMeta object from whatever is CURRENTLY in the draft
  // fields. Used by both "Save post details" and "Schedule" so neither path
  // can ever send stale data.
  const buildFreshMeta = (): PostMeta => ({
    postType: draftPostType,
    price: draftPostType === "ppv" ? draftPrice : 0,
    caption: draftCaption,
  });

  // Commits the draft to local item state + localStorage. Returns the fresh
  // meta so callers (like scheduleFromDetail) can use it immediately without
  // waiting on a state update / re-render.
  const commitPostMeta = (item: ReviewItem): PostMeta => {
    const fresh = buildFreshMeta();
    setItems((arr) => arr.map((i) => (i.id === item.id ? { ...i, postMeta: fresh } : i)));
    const map = loadPostMetaMap();
    map[item.contentId] = fresh;
    savePostMetaMap(map);
    return fresh;
  };

  const savePostMeta = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    commitPostMeta(item);
    toast.success("Post details saved");
  };

  // FIX: Schedule now always commits the live draft values first, then opens
  // the dialog with the item carrying those exact fresh values — so it can
  // never show/send what was there before your edits.
  const scheduleFromDetail = (item: ReviewItem) => {
    const fresh = commitPostMeta(item);
    setScheduleItem({ ...item, postMeta: fresh });
    setOpenId(null);
  };

  const toggleSelect = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const bulkApprove = () => { selected.forEach((id) => approve(id)); setSelected([]); };
  const bulkReject  = () => { selected.forEach((id) => reject(id));  setSelected([]); };

  const onScheduled = (id: string) => {
    updateLocalStatus(id, "scheduled", { at: new Date().toISOString(), label: "Scheduled", kind: "scheduled" });
    queryClient.invalidateQueries({ queryKey: ["review-queue"] });
    queryClient.invalidateQueries({ queryKey: ["library"] });
  };

  const openDetail = (item: ReviewItem) => {
    setOpenId(item.id);
    setNoteDraft(item.notes ?? "");
    setDraftPostType(item.postMeta.postType);
    setDraftPrice(item.postMeta.price || PPV_PRICE_PRESETS[0]);
    setDraftCaption(item.postMeta.caption);
  };

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        <main className="flex flex-1 flex-col gap-6 p-6 lg:p-8">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ClipboardCheck className="h-3.5 w-3.5" />
              <span>Moderation</span>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="font-display text-3xl font-semibold tracking-tight">Review Queue</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Approve or reject content, set pricing &amp; caption, then schedule directly from here.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link to="/library">
                    <Library className="mr-1.5 h-3.5 w-3.5" />
                    Content Library
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link to="/generate">
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    Generate
                  </Link>
                </Button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <DashboardCard label="Total in Queue" value={stats.total} icon={ClipboardCheck} accent="primary" />
            <DashboardCard label="Pending" value={stats.pending} icon={ClipboardCheck} accent="chart-4" hint="awaiting review" />
            <DashboardCard label="Approved" value={stats.approved} icon={CheckCircle2} accent="chart-2" hint="ready to schedule" />
            <DashboardCard label="Scheduled" value={stats.scheduled} icon={CalendarPlus} accent="chart-3" hint="going live" />
            <DashboardCard label="Rejected" value={stats.rejected} icon={XCircle} accent="chart-5" />
          </div>

          <Card className="border-border/60 bg-card/60">
            <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by character, caption or job ID…" className="pl-9" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ReviewStatus | "all")}>
                  <SelectTrigger className="w-[150px]">
                    <Filter className="mr-1 h-3.5 w-3.5" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as ContentType | "all")}>
                  <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    <SelectItem value="video">Videos</SelectItem>
                    <SelectItem value="image">Images</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {selected.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
              <p className="text-sm">
                <span className="font-medium text-foreground">{selected.length} selected</span>
                <span className="text-muted-foreground"> — apply a bulk action</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={bulkReject}>
                  <XCircle className="mr-1.5 h-3.5 w-3.5" /> Reject selected
                </Button>
                <Button size="sm" onClick={bulkApprove}>
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Approve selected
                </Button>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-80 animate-pulse rounded-xl bg-muted/40" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((item) => (
                <QueueCard
                  key={item.id}
                  item={item}
                  selected={selected.includes(item.id)}
                  onToggle={() => toggleSelect(item.id)}
                  onOpen={() => openDetail(item)}
                  onApprove={() => approve(item.id)}
                  onReject={() => reject(item.id)}
                  onSchedule={() => setScheduleItem(item)}
                />
              ))}
            </div>
          )}
        </main>

        <Sheet open={!!openItem} onOpenChange={(o) => !o && setOpenId(null)}>
          <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-2xl">
            {openItem && (
              <DetailPanel
                item={openItem}
                noteDraft={noteDraft}
                onNoteChange={setNoteDraft}
                onSaveNote={() => saveNote(openItem.id)}
                draftPostType={draftPostType}
                setDraftPostType={setDraftPostType}
                draftPrice={draftPrice}
                setDraftPrice={setDraftPrice}
                draftCaption={draftCaption}
                setDraftCaption={setDraftCaption}
                onSavePostMeta={() => savePostMeta(openItem.id)}
                onApprove={() => approve(openItem.id)}
                onReject={() => reject(openItem.id)}
                onSchedule={() => scheduleFromDetail(openItem)}
              />
            )}
          </SheetContent>
        </Sheet>

        <ScheduleDialog
          item={scheduleItem}
          onClose={() => setScheduleItem(null)}
          onScheduled={onScheduled}
        />
      </SidebarInset>
    </SidebarProvider>
  );
}

// ---------- Queue Card ----------

function QueueCard({
  item, selected, onToggle, onOpen, onApprove, onReject, onSchedule,
}: {
  item: ReviewItem;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onApprove: () => void;
  onReject: () => void;
  onSchedule: () => void;
}) {
  const isApproved = item.status === "approved";
  const isScheduled = item.status === "scheduled";

  return (
    <Card className={cn("group relative overflow-hidden border-border/60 bg-card transition-all hover:border-primary/40", selected && "border-primary ring-1 ring-primary/40")}>
      <div className="relative aspect-[4/5] cursor-pointer overflow-hidden" onClick={onOpen}>
        {item.type === "video" ? (
          <video
            src={item.preview}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            muted playsInline preload="metadata"
            onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
            onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
          />
        ) : (
          <img src={item.thumbnail} alt={item.character}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />

        <div className="absolute inset-x-0 top-0 flex items-start justify-between p-3">
          <div onClick={(e) => e.stopPropagation()}>
            <Checkbox checked={selected} onCheckedChange={onToggle} className="border-white/40 bg-background/60 backdrop-blur" />
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md bg-background/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-foreground backdrop-blur">
              {item.type === "video" ? <Film className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
              {item.type}
            </span>
            <StatusBadge status={item.status} />
            <PostTypeBadge postMeta={item.postMeta} />
          </div>
        </div>

        {item.type === "video" && (
      <div className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-background/80 backdrop-blur">
              <Play className="h-5 w-5 translate-x-[1px] text-foreground" />
            </div>
          </div>

      
        )}

        <div className="absolute inset-x-0 bottom-0 p-3">
          <p className="font-medium text-foreground">{item.character}</p>
          <p className="line-clamp-1 text-xs text-muted-foreground">{item.postMeta.caption || "No caption"}</p>
          <p className="text-[11px] text-muted-foreground/80">{timeAgo(item.createdAt)} · {item.jobId.slice(0, 8)}</p>
        </div>
      </div>

      <CardContent className="flex items-center gap-2 p-3 bg-card relative z-10">
        {isApproved ? (
          <>
            <Button size="sm" variant="outline" className="flex-1" onClick={onReject}>
              <XCircle className="mr-1 h-3.5 w-3.5" /> Reject
            </Button>
            <Button size="sm" className="flex-1 gap-1" onClick={onSchedule}>
              <CalendarPlus className="h-3.5 w-3.5" /> Schedule
            </Button>
          </>
        ) : isScheduled ? (
          <Button size="sm" variant="outline" className="w-full" disabled>
            <CalendarPlus className="mr-1 h-3.5 w-3.5" /> Scheduled
          </Button>
        ) : (
          <>
            <Button size="sm" variant="outline" className="flex-1" onClick={onReject} disabled={item.status === "rejected"}>
              <XCircle className="mr-1 h-3.5 w-3.5" /> Reject
            </Button>
            <Button size="sm" className="flex-1" onClick={onApprove}>
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Approve
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Detail Panel ----------

function DetailPanel({
  item, noteDraft, onNoteChange, onSaveNote,
  draftPostType, setDraftPostType, draftPrice, setDraftPrice, draftCaption, setDraftCaption, onSavePostMeta,
  onApprove, onReject, onSchedule,
}: {
  item: ReviewItem;
  noteDraft: string;
  onNoteChange: (v: string) => void;
  onSaveNote: () => void;
  draftPostType: PostType;
  setDraftPostType: (v: PostType) => void;
  draftPrice: number;
  setDraftPrice: (v: number) => void;
  draftCaption: string;
  setDraftCaption: (v: string) => void;
  onSavePostMeta: () => void;
  onApprove: () => void;
  onReject: () => void;
  onSchedule: () => void;
}) {
  const isApproved = item.status === "approved";
  const isScheduled = item.status === "scheduled";

  const isDirty =
    draftPostType !== item.postMeta.postType ||
    draftCaption !== item.postMeta.caption ||
    (draftPostType === "ppv" && draftPrice !== item.postMeta.price);

  return (
    <div className="flex h-full flex-col">
      <SheetHeader className="border-b border-border/60 px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <SheetTitle className="font-display text-xl">{item.character}</SheetTitle>
            <SheetDescription>
              {item.type === "video" ? "Video Asset" : "Image Asset"} · <span className="font-mono text-xs">{item.jobId}</span>
            </SheetDescription>
          </div>
          <StatusBadge status={item.status} />
        </div>
      </SheetHeader>

      <ScrollArea className="flex-1">
        <div className="space-y-6 px-6 py-6">
          {/* Media preview */}
          <div className="relative overflow-hidden rounded-xl border border-border/60 bg-muted">
            {item.type === "video" ? (
              <video src={item.preview} controls playsInline className="w-full object-cover aspect-video" />
            ) : (
              <img src={item.preview} alt={item.character} className="w-full object-cover aspect-[4/5]" />
            )}
          </div>

          {/* Approve / Reject / Schedule */}
          <div className="grid grid-cols-2 gap-2">
            {!isScheduled && (
              <Button variant="outline" onClick={onReject} disabled={item.status === "rejected"}>
                <XCircle className="mr-1.5 h-4 w-4" /> Reject
              </Button>
            )}
            {!isApproved && !isScheduled && (
              <Button onClick={onApprove}>
                <CheckCircle2 className="mr-1.5 h-4 w-4" /> Approve
              </Button>
            )}
            {(isApproved || isScheduled) && (
              <Button onClick={onSchedule} disabled={isScheduled} className="gap-1.5">
                <CalendarPlus className="h-4 w-4" />
                {isScheduled ? "Scheduled ✓" : "Schedule now"}
              </Button>
            )}
          </div>

          {isApproved && (
            <div className="rounded-lg border border-success/30 bg-success/5 px-3 py-2.5">
              <p className="text-sm font-medium text-success">
                ✓ Approved — "Schedule now" uses whatever is currently in Post details below, even if unsaved.
              </p>
            </div>
          )}

          <Separator />

          {/* Post details — fully local, no Supabase writes */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-primary" /> Post details
              </h3>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Stored on this device</span>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Post Type</Label>
              <div className="inline-flex rounded-lg border border-border bg-muted/20 p-1">
                <button
                  type="button"
                  onClick={() => setDraftPostType("normal")}
                  disabled={isScheduled}
                  className={cn(
                    "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                    draftPostType === "normal" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    isScheduled && "cursor-not-allowed opacity-60",
                  )}
                >
                  Normal Post
                </button>
                <button
                  type="button"
                  onClick={() => setDraftPostType("ppv")}
                  disabled={isScheduled}
                  className={cn(
                    "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                    draftPostType === "ppv" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    isScheduled && "cursor-not-allowed opacity-60",
                  )}
                >
                  PPV Post
                </button>
              </div>
            </div>

            {draftPostType === "ppv" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Price (USD)</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {PPV_PRICE_PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      disabled={isScheduled}
                      onClick={() => setDraftPrice(p)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        draftPrice === p ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40",
                        isScheduled && "cursor-not-allowed opacity-60",
                      )}
                    >
                      ${p}
                    </button>
                  ))}
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={draftPrice}
                    disabled={isScheduled}
                    onChange={(e) => setDraftPrice(Math.max(0, Number(e.target.value) || 0))}
                    className="w-28"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Caption</Label>
              <Textarea
                rows={4}
                value={draftCaption}
                disabled={isScheduled}
                onChange={(e) => setDraftCaption(e.target.value)}
                placeholder="Write a caption for this post…"
              />
            </div>

            <div className="flex items-center justify-between">
              {isDirty && !isScheduled && (
                <span className="text-[11px] text-muted-foreground">Unsaved changes — will still be used if you click Schedule.</span>
              )}
              <div className="ml-auto">
                <Button size="sm" onClick={onSavePostMeta} disabled={!isDirty || isScheduled}>
                  Save post details
                </Button>
              </div>
            </div>
          </section>

          <Separator />

          {/* Reviewer notes */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Reviewer notes</h3>
            <Textarea value={noteDraft} onChange={(e) => onNoteChange(e.target.value)}
              placeholder="e.g. Improve lighting, re-render scene 3…" rows={3} />
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={onSaveNote}>Save note</Button>
            </div>
          </section>

          {/* History */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Review history</h3>
            <ol className="space-y-3">
              {item.history.map((h, i) => (
                <li key={i} className="flex gap-3">
                  <div className="relative flex flex-col items-center">
                    <span className={cn("mt-1 h-2.5 w-2.5 rounded-full ring-4 ring-background",
                      h.kind === "approved" && "bg-success",
                      h.kind === "rejected" && "bg-destructive",
                      h.kind === "scheduled" && "bg-primary",
                      h.kind === "published" && "bg-chart-2",
                      (h.kind === "generated" || h.kind === "queued") && "bg-muted-foreground",
                    )} />
                    {i < item.history.length - 1 && <span className="mt-1 h-full w-px flex-1 bg-border" />}
                  </div>
                  <div className="pb-3">
                    <p className="text-sm text-foreground">{h.label}</p>
                    <p className="text-xs text-muted-foreground">{new Date(h.at).toLocaleString()}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-border/60 bg-card/40 py-20 text-center">
      <div className="max-w-sm space-y-3">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted">
          <Inbox className="h-5 w-5 text-muted-foreground" />
        </div>
        <h3 className="font-display text-lg font-semibold">Nothing waiting for review</h3>
        <p className="text-sm text-muted-foreground">
          Generated content lands here automatically. You can also send items from the Content Library.
        </p>
        <div className="flex justify-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/library"><Library className="mr-1.5 h-3.5 w-3.5" />View Library</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/generate"><Sparkles className="mr-1.5 h-3.5 w-3.5" />Generate Content</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
