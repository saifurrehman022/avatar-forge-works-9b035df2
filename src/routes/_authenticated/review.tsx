import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardCheck,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Clock,
  Search,
  Image as ImageIcon,
  Video as VideoIcon,
  Play,
  ArrowLeft,
  Send,
  FileText,
  Sparkles,
  Filter,
  Inbox,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { reviewService, generationService } from "@/services";

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { AppHeader } from "@/components/dashboard/app-header";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
      {
        name: "description",
        content:
          "Moderate, approve and reject AI-generated content before scheduling and publishing.",
      },
    ],
  }),
  component: ReviewPage,
  errorComponent: RouteErrorBoundary,
});


// ---------- Types ----------

type ReviewStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "scheduled"
  | "published";

type ContentType = "image" | "video";

type HistoryEvent = {
  at: string;
  label: string;
  kind: "generated" | "queued" | "approved" | "rejected" | "regenerated" | "scheduled" | "published";
  by?: string;
};

type ReviewItem = {
  id: string;
  type: ContentType;
  character: string;
  thumbnail: string;
  preview: string;
  referenceImage: string;
  createdAt: string;
  status: ReviewStatus;
  jobId: string;
  settings: {
    fps: number;
    framesPerScene: number;
    numScenes: number;
    samplingSteps: number;
  };
  scenes: string[];
  negativePrompt: string;
  notes?: string;
  history: HistoryEvent[];
};

// ---------- Data loading ----------

const NEG_DEFAULT =
  "low quality, blurry, extra limbs, distorted face, watermark, text, deformed hands";

const PLACEHOLDER_IMG = "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800&q=80";

type DbReviewRow = {
  id: string;
  content_type: "image" | "video";
  content_id: string;
  status: string;
  reviewer_id: string | null;
  reviewed_at: string | null;
  notes: string | null;
  created_at: string;
};

async function fetchQueue(): Promise<ReviewItem[]> {
  const { data: rows, error } = await supabase
    .from("review_queue")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;

  const imageIds = (rows ?? []).filter((r) => r.content_type === "image").map((r) => r.content_id);
  const videoIds = (rows ?? []).filter((r) => r.content_type === "video").map((r) => r.content_id);

  const [imgRes, vidRes, charRes] = await Promise.all([
    imageIds.length
      ? supabase.from("images").select("id, image_url, prompt, character_id, created_at, status").in("id", imageIds)
      : Promise.resolve({ data: [], error: null } as const),
    videoIds.length
      ? supabase
          .from("videos")
          .select("id, video_url, prompt, scene_prompts, character_id, created_at, status")
          .in("id", videoIds)
      : Promise.resolve({ data: [], error: null } as const),
    supabase.from("characters").select("id, name, reference_image_url"),
  ]);

  const imgMap = new Map((imgRes.data ?? []).map((i: any) => [i.id, i]));
  const vidMap = new Map((vidRes.data ?? []).map((v: any) => [v.id, v]));
  const charMap = new Map((charRes.data ?? []).map((c: any) => [c.id, c]));

  return (rows ?? []).map((r: DbReviewRow): ReviewItem => {
    const isVideo = r.content_type === "video";
    const src: any = isVideo ? vidMap.get(r.content_id) : imgMap.get(r.content_id);
    const char: any = src?.character_id ? charMap.get(src.character_id) : null;
    const scenes: string[] = isVideo && Array.isArray(src?.scene_prompts) ? src.scene_prompts : src?.prompt ? [src.prompt] : [];
    const media = isVideo ? src?.video_url : src?.image_url;
    const thumb = isVideo ? char?.reference_image_url || PLACEHOLDER_IMG : media || PLACEHOLDER_IMG;
    return {
      id: r.id,
      type: r.content_type,
      character: char?.name ?? "Lila",
      thumbnail: thumb,
      preview: media || thumb,
      referenceImage: char?.reference_image_url || PLACEHOLDER_IMG,
      createdAt: r.created_at,
      status: r.status as ReviewStatus,
      jobId: src?.id ?? r.content_id,
      settings: { fps: 16, framesPerScene: 257, numScenes: scenes.length || 1, samplingSteps: 29 },
      scenes: scenes.length ? scenes : ["—"],
      negativePrompt: NEG_DEFAULT,
      notes: r.notes ?? undefined,
      history: [
        { at: src?.created_at ?? r.created_at, label: "Generated", kind: "generated" },
        { at: r.created_at, label: "Sent to review", kind: "queued" },
        ...(r.reviewed_at
          ? [
              {
                at: r.reviewed_at,
                label: r.status === "approved" ? "Approved" : "Rejected",
                kind: r.status as "approved" | "rejected",
              } as HistoryEvent,
            ]
          : []),
      ],
    };
  });
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
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
        STATUS_STYLE[status],
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {STATUS_LABEL[status]}
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

// ---------- Page ----------

function ReviewPage() {
  const queryClient = useQueryClient();
  const { data: queueItems = [] } = useQuery({
    queryKey: ["review-queue"],
    queryFn: fetchQueue,
    staleTime: 10_000,
  });
  const [items, setItems] = useState<ReviewItem[]>([]);
  useEffect(() => setItems(queueItems), [queueItems]);

  useEffect(() => {
    const ch = supabase
      .channel("review-queue-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "review_queue" }, () =>
        queryClient.invalidateQueries({ queryKey: ["review-queue"] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [queryClient]);

  const [selected, setSelected] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | "all">("all");
  const [typeFilter, setTypeFilter] = useState<ContentType | "all">("all");
  const [charFilter, setCharFilter] = useState<string>("all");
  const [noteDraft, setNoteDraft] = useState("");

  const openItem = items.find((i) => i.id === openId) ?? null;
  const CHARS = Array.from(new Set(items.map((i) => i.character)));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (typeFilter !== "all" && i.type !== typeFilter) return false;
      if (charFilter !== "all" && i.character !== charFilter) return false;
      if (!q) return true;
      return (
        i.character.toLowerCase().includes(q) ||
        i.jobId.toLowerCase().includes(q) ||
        i.scenes.some((s) => s.toLowerCase().includes(q))
      );
    });
  }, [items, search, statusFilter, typeFilter, charFilter]);

  const stats = useMemo(() => {
    const pending = items.filter((i) => i.status === "pending").length;
    const approvedToday = items.filter(
      (i) =>
        i.status === "approved" &&
        Date.now() - new Date(i.history.at(-1)?.at ?? i.createdAt).getTime() <
          24 * 3600 * 1000,
    ).length;
    const rejectedToday = items.filter((i) => i.status === "rejected").length;
    const regen = items.filter((i) =>
      i.history.some((h) => h.kind === "regenerated"),
    ).length;
    return { pending, approvedToday, rejectedToday, regen };
  }, [items]);

  const setStatus = (id: string, status: ReviewStatus, evt: HistoryEvent) =>
    setItems((arr) =>
      arr.map((i) =>
        i.id === id ? { ...i, status, history: [...i.history, evt] } : i,
      ),
    );

  const approve = async (id: string) => {
    setStatus(id, "approved", { at: new Date().toISOString(), label: "Approved", kind: "approved" });
    try {
      await reviewService.decide(id, "approved");
      toast.success("Content approved");
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed to approve"); }
  };
  const reject = async (id: string) => {
    setStatus(id, "rejected", { at: new Date().toISOString(), label: "Rejected", kind: "rejected" });
    try {
      await reviewService.decide(id, "rejected");
      toast.error("Content rejected");
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed to reject"); }
  };
  const regenerate = async (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setItems((arr) =>
      arr.map((i) =>
        i.id === id
          ? { ...i, status: "pending", history: [...i.history, { at: new Date().toISOString(), label: "Regeneration requested", kind: "regenerated" }] }
          : i,
      ),
    );
    try {
      const { data: userRes } = await supabase.auth.getUser();
      await generationService.enqueue({
        type: item.type,
        status: "queued",
        created_by: userRes.user?.id ?? null,
        input_payload: { scenes: item.scenes, fps: item.settings.fps, framesPerScene: item.settings.framesPerScene, samplingSteps: item.settings.samplingSteps, regenerationOf: id },
      } as any);
      toast("Regeneration queued");
    } catch (e: any) { toast.error(e?.message ?? "Failed to regenerate"); }
  };

  const saveNote = async (id: string) => {
    setItems((arr) => arr.map((i) => (i.id === id ? { ...i, notes: noteDraft } : i)));
    try {
      const { error } = await supabase.from("review_queue").update({ notes: noteDraft }).eq("id", id);
      if (error) throw error;
      toast.success("Reviewer note saved");
    } catch (e: any) { toast.error(e?.message ?? "Failed to save note"); }
  };

  const toggleSelect = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );

  const bulkApprove = () => {
    selected.forEach((id) => approve(id));
    setSelected([]);
  };
  const bulkReject = () => {
    selected.forEach((id) => reject(id));
    setSelected([]);
  };
  const bulkReturn = () => {
    toast(`${selected.length} item${selected.length === 1 ? "" : "s"} returned to library`);
    setSelected([]);
  };

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        <main className="flex flex-1 flex-col gap-6 p-6 lg:p-8">
          {/* Page header */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ClipboardCheck className="h-3.5 w-3.5" />
              <span>Moderation</span>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="font-display text-3xl font-semibold tracking-tight">
                  Review Queue
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Approve, reject or regenerate AI-generated content before it
                  reaches scheduling.
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link to="/library">
                  <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                  Back to Library
                </Link>
              </Button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <DashboardCard
              label="Pending Review"
              value={stats.pending}
              icon={ClipboardCheck}
              accent="chart-4"
              hint="awaiting moderator"
            />
            <DashboardCard
              label="Approved Today"
              value={stats.approvedToday}
              icon={CheckCircle2}
              accent="chart-2"
              delta={12}
              hint="vs. yesterday"
            />
            <DashboardCard
              label="Rejected Today"
              value={stats.rejectedToday}
              icon={XCircle}
              accent="chart-5"
              delta={-4}
              hint="vs. yesterday"
            />
            <DashboardCard
              label="Regeneration"
              value={stats.regen}
              icon={RotateCcw}
              accent="chart-3"
              hint="active requests"
            />
            <DashboardCard
              label="Avg. Review Time"
              value="2m 14s"
              icon={Clock}
              accent="primary"
              delta={-8}
              hint="last 24h"
            />
          </div>

          {/* Filters */}
          <Card className="border-border/60 bg-card/60">
            <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by character, prompt, scene or job ID…"
                  className="pl-9"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={statusFilter}
                  onValueChange={(v) => setStatusFilter(v as ReviewStatus | "all")}
                >
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
                <Select
                  value={typeFilter}
                  onValueChange={(v) => setTypeFilter(v as ContentType | "all")}
                >
                  <SelectTrigger className="w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    <SelectItem value="video">Videos</SelectItem>
                    <SelectItem value="image">Images</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={charFilter} onValueChange={setCharFilter}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All characters</SelectItem>
                    {CHARS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Bulk bar */}
          {selected.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
              <p className="text-sm">
                <span className="font-medium text-foreground">
                  {selected.length} selected
                </span>
                <span className="text-muted-foreground"> — apply a bulk action</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={bulkReturn}>
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                  Send back to Library
                </Button>
                <Button size="sm" variant="outline" onClick={bulkReject}>
                  <XCircle className="mr-1.5 h-3.5 w-3.5" />
                  Reject selected
                </Button>
                <Button size="sm" onClick={bulkApprove}>
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  Approve selected
                </Button>
              </div>
            </div>
          )}

          {/* Queue */}
          {filtered.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((item) => (
                <QueueCard
                  key={item.id}
                  item={item}
                  selected={selected.includes(item.id)}
                  onToggle={() => toggleSelect(item.id)}
                  onOpen={() => {
                    setOpenId(item.id);
                    setNoteDraft(item.notes ?? "");
                  }}
                  onApprove={() => approve(item.id)}
                  onReject={() => reject(item.id)}
                  onRegenerate={() => regenerate(item.id)}
                />
              ))}
            </div>
          )}
        </main>

        {/* Detail sheet */}
        <Sheet open={!!openItem} onOpenChange={(o) => !o && setOpenId(null)}>
          <SheetContent
            side="right"
            className="w-full overflow-y-auto p-0 sm:max-w-2xl"
          >
            {openItem && (
              <DetailPanel
                item={openItem}
                noteDraft={noteDraft}
                onNoteChange={setNoteDraft}
                onSaveNote={() => saveNote(openItem.id)}
                onApprove={() => approve(openItem.id)}
                onReject={() => reject(openItem.id)}
                onRegenerate={() => regenerate(openItem.id)}
              />
            )}
          </SheetContent>
        </Sheet>
      </SidebarInset>
    </SidebarProvider>
  );
}

// ---------- Queue card ----------

function QueueCard({
  item,
  selected,
  onToggle,
  onOpen,
  onApprove,
  onReject,
  onRegenerate,
}: {
  item: ReviewItem;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onApprove: () => void;
  onReject: () => void;
  onRegenerate: () => void;
}) {
  return (
    <Card
      className={cn(
        "group relative overflow-hidden border-border/60 bg-card transition-all hover:border-primary/40",
        selected && "border-primary ring-1 ring-primary/40",
      )}
    >
      <div className="relative aspect-[4/5] cursor-pointer overflow-hidden" onClick={onOpen}>
        <img
          src={item.thumbnail}
          alt={item.character}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />

        {/* Top row */}
        <div className="absolute inset-x-0 top-0 flex items-start justify-between p-3">
          <div onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={selected}
              onCheckedChange={onToggle}
              className="border-white/40 bg-background/60 backdrop-blur"
            />
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md bg-background/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-foreground backdrop-blur">
              {item.type === "video" ? (
                <VideoIcon className="h-3 w-3" />
              ) : (
                <ImageIcon className="h-3 w-3" />
              )}
              {item.type}
            </span>
            <StatusBadge status={item.status} />
          </div>
        </div>

        {item.type === "video" && (
          <div className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-background/80 backdrop-blur">
              <Play className="h-5 w-5 translate-x-[1px] text-foreground" />
            </div>
          </div>
        )}

        {/* Bottom meta */}
        <div className="absolute inset-x-0 bottom-0 p-3">
          <p className="font-medium text-foreground">{item.character}</p>
          <p className="text-xs text-muted-foreground">
            {timeAgo(item.createdAt)} · {item.jobId}
          </p>
        </div>
      </div>

      <CardContent className="flex items-center gap-2 p-3">
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={onReject}
          disabled={item.status === "rejected"}
        >
          <XCircle className="mr-1 h-3.5 w-3.5" />
          Reject
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onRegenerate}
          title="Regenerate"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          className="flex-1"
          onClick={onApprove}
          disabled={item.status === "approved"}
        >
          <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
          Approve
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------- Detail panel ----------

function DetailPanel({
  item,
  noteDraft,
  onNoteChange,
  onSaveNote,
  onApprove,
  onReject,
  onRegenerate,
}: {
  item: ReviewItem;
  noteDraft: string;
  onNoteChange: (v: string) => void;
  onSaveNote: () => void;
  onApprove: () => void;
  onReject: () => void;
  onRegenerate: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <SheetHeader className="border-b border-border/60 px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <SheetTitle className="font-display text-xl">
              {item.character}
            </SheetTitle>
            <SheetDescription>
              {item.type === "video" ? "Video" : "Image"} · {item.jobId}
            </SheetDescription>
          </div>
          <StatusBadge status={item.status} />
        </div>
      </SheetHeader>

      <ScrollArea className="flex-1">
        <div className="space-y-6 px-6 py-6">
          {/* Preview */}
          <div className="relative overflow-hidden rounded-xl border border-border/60 bg-muted">
            <img
              src={item.preview}
              alt={item.character}
              className={cn(
                "w-full object-cover",
                item.type === "video" ? "aspect-video" : "aspect-[4/5]",
              )}
            />
            {item.type === "video" && (
              <div className="absolute inset-0 grid place-items-center">
                <div className="grid h-14 w-14 place-items-center rounded-full bg-background/80 backdrop-blur">
                  <Play className="h-6 w-6 translate-x-[1px]" />
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="grid grid-cols-3 gap-2">
            <Button variant="outline" onClick={onReject}>
              <XCircle className="mr-1.5 h-4 w-4" />
              Reject
            </Button>
            <Button variant="outline" onClick={onRegenerate}>
              <RotateCcw className="mr-1.5 h-4 w-4" />
              Regenerate
            </Button>
            <Button onClick={onApprove}>
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              Approve
            </Button>
          </div>

          <Separator />

          {/* Generation details */}
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-primary" />
              Generation details
            </h3>
            <div className="flex gap-4">
              <img
                src={item.referenceImage}
                alt="reference"
                className="h-28 w-24 rounded-lg border border-border/60 object-cover"
              />
              <div className="grid flex-1 grid-cols-2 gap-2 text-xs">
                <Stat label="FPS" value={item.settings.fps || "—"} />
                <Stat label="Frames / scene" value={item.settings.framesPerScene || "—"} />
                <Stat label="Scenes" value={item.settings.numScenes} />
                <Stat label="Sampling steps" value={item.settings.samplingSteps} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Stat label="Generated" value={new Date(item.createdAt).toLocaleString()} />
              <Stat label="Job ID" value={item.jobId} mono />
            </div>
          </section>

          {/* Scene prompts */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Scene prompts</h3>
            <div className="space-y-2">
              {item.scenes.map((s, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-border/60 bg-muted/40 p-2.5 text-xs"
                >
                  <span className="mr-2 inline-flex h-4 w-4 items-center justify-center rounded bg-primary/20 text-[10px] font-medium text-primary">
                    {i + 1}
                  </span>
                  <span className="text-muted-foreground">{s}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Negative */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Negative prompt</h3>
            <p className="rounded-lg border border-border/60 bg-muted/40 p-2.5 text-xs text-muted-foreground">
              {item.negativePrompt}
            </p>
          </section>

          {/* Notes */}
          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="h-4 w-4" />
              Reviewer notes
            </h3>
            <Textarea
              value={noteDraft}
              onChange={(e) => onNoteChange(e.target.value)}
              placeholder="e.g. Improve lighting, better facial consistency, scene 4 needs adjustment"
              rows={3}
            />
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={onSaveNote}>
                Save note
              </Button>
            </div>
          </section>

          {/* History */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Review history</h3>
            <ol className="space-y-3">
              {item.history.map((h, i) => (
                <li key={i} className="flex gap-3">
                  <div className="relative flex flex-col items-center">
                    <span
                      className={cn(
                        "mt-1 h-2.5 w-2.5 rounded-full ring-4 ring-background",
                        h.kind === "approved" && "bg-success",
                        h.kind === "rejected" && "bg-destructive",
                        h.kind === "regenerated" && "bg-chart-3",
                        h.kind === "scheduled" && "bg-primary",
                        h.kind === "published" && "bg-chart-2",
                        (h.kind === "generated" || h.kind === "queued") &&
                          "bg-muted-foreground",
                      )}
                    />
                    {i < item.history.length - 1 && (
                      <span className="mt-1 h-full w-px flex-1 bg-border" />
                    )}
                  </div>
                  <div className="pb-3">
                    <p className="text-sm text-foreground">{h.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(h.at).toLocaleString()}
                    </p>
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

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/40 p-2.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={cn("mt-0.5 text-foreground", mono && "font-mono text-xs")}>
        {value}
      </p>
    </div>
  );
}

// ---------- Empty ----------

function EmptyState() {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-border/60 bg-card/40 py-20 text-center">
      <div className="max-w-sm space-y-3">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted">
          <Inbox className="h-5 w-5 text-muted-foreground" />
        </div>
        <h3 className="font-display text-lg font-semibold">
          Nothing is waiting for review
        </h3>
        <p className="text-sm text-muted-foreground">
          New AI-generated content will land here for moderation as soon as
          generation jobs complete.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to="/library">View Content Library</Link>
        </Button>
      </div>
    </div>
  );
}
