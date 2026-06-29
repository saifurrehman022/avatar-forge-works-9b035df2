


import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ImageIcon,
  Video,
  CalendarClock,
  ClipboardCheck,
  Cpu,
  Image as ImageLucide,
  Film,
  CalendarPlus,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { AppHeader } from "@/components/dashboard/app-header";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated")({
  head: () => ({
    meta: [
      { title: "Dashboard — Lila Studio" },
      {
        name: "description",
        content:
          "Internal control room for Lila Studio — manage AI image & video generation, scheduling, and reviews.",
      },
      { property: "og:title", content: "Dashboard — Lila Studio" },
      {
        property: "og:description",
        content:
          "Internal control room for Lila Studio — manage AI image & video generation, scheduling, and reviews.",
      },
    ],
  }),
  component: DashboardPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

type ActivityKind =
  | "image_generated"
  | "video_generated"
  | "approved"
  | "rejected"
  | "scheduled"
  | "published"
  | "job_failed";

interface ActivityItem {
  id: string;
  kind: ActivityKind;
  label: string;
  sub: string;
  at: string;
}

interface UpcomingPost {
  id: string;
  type: "image" | "video";
  character: string;
  thumbnail: string;
  scheduledAt: string;
  platform: string;
}

// ─── Data fetchers ────────────────────────────────────────────────────────────

async function fetchDashboardStats() {
  const [imgs, vids, scheduled, active] = await Promise.all([
    supabase.from("images").select("*", { count: "exact", head: true }),
    supabase.from("videos").select("*", { count: "exact", head: true }),
    supabase
      .from("schedules")
      .select("*", { count: "exact", head: true })
      .eq("status", "scheduled"),
    supabase
      .from("generation_jobs")
      .select("*", { count: "exact", head: true })
      .in("status", ["queued", "processing"]),
  ]);

  // ── FIX: count pending reviews the same way review.tsx does it ──
  // review.tsx shows ALL images + videos that aren't approved/rejected/scheduled/published.
  // Items may not have a review_queue row yet (rows are created lazily on first action).
  // So we count images and videos where status is not one of the "done" statuses.
  const [pendingImgs, pendingVids] = await Promise.all([
    supabase
      .from("images")
      .select("*", { count: "exact", head: true })
      .not("status", "in", '("approved","rejected","scheduled","published")'),
    supabase
      .from("videos")
      .select("*", { count: "exact", head: true })
      .not("status", "in", '("approved","rejected","scheduled","published")'),
  ]);

  const pending = (pendingImgs.count ?? 0) + (pendingVids.count ?? 0);

  return {
    images:    imgs.count      ?? 0,
    videos:    vids.count      ?? 0,
    scheduled: scheduled.count ?? 0,
    pending,
    active:    active.count    ?? 0,
  };
}

async function fetchActivity(): Promise<ActivityItem[]> {
  const [imgR, vidR, reviewR, schedR, charR] = await Promise.all([
    supabase
      .from("images")
      .select("id, created_at, status, character_id, prompt")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("videos")
      .select("id, created_at, status, character_id, prompt")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("review_queue")
      .select("id, created_at, reviewed_at, status, content_type, content_id")
      .order("reviewed_at", { ascending: false })
      .limit(10),
    supabase
      .from("schedules")
      .select("id, created_at, publish_time, content_type, platform, status")
      .order("created_at", { ascending: false })
      .limit(6),
    supabase.from("characters").select("id, name"),
  ]);

  const charMap = new Map(
    (charR.data ?? []).map((c: any) => [c.id, c.name as string])
  );

  const events: ActivityItem[] = [];

  for (const img of imgR.data ?? []) {
    const char = img.character_id ? (charMap.get(img.character_id) ?? "Lila") : "Lila";
    const promptSnippet = img.prompt ? img.prompt.slice(0, 48) + (img.prompt.length > 48 ? "…" : "") : "New portrait";
    events.push({
      id:    `img-${img.id}`,
      kind:  img.status === "rejected" ? "rejected" : "image_generated",
      label: `Image generated · ${char}`,
      sub:   promptSnippet,
      at:    img.created_at,
    });
  }

  for (const vid of vidR.data ?? []) {
    const char = vid.character_id ? (charMap.get(vid.character_id) ?? "Lila") : "Lila";
    const promptSnippet = vid.prompt ? vid.prompt.slice(0, 48) + (vid.prompt.length > 48 ? "…" : "") : "New clip";
    events.push({
      id:    `vid-${vid.id}`,
      kind:  vid.status === "rejected" ? "rejected" : "video_generated",
      label: `Video generated · ${char}`,
      sub:   promptSnippet,
      at:    vid.created_at,
    });
  }

  for (const rq of reviewR.data ?? []) {
    if (!rq.reviewed_at) continue;
    if (rq.status === "approved" || rq.status === "rejected") {
      events.push({
        id:    `rq-${rq.id}`,
        kind:  rq.status === "approved" ? "approved" : "rejected",
        label: rq.status === "approved" ? `Approved · ${rq.content_type}` : `Rejected · ${rq.content_type}`,
        sub:   "Via Review Queue",
        at:    rq.reviewed_at,
      });
    }
  }

  for (const sc of schedR.data ?? []) {
    events.push({
      id:    `sc-${sc.id}`,
      kind:  sc.status === "published" ? "published" : "scheduled",
      label: sc.status === "published" ? `Published · ${sc.platform ?? "Fanvue"}` : `Scheduled · ${sc.platform ?? "Fanvue"}`,
      sub:   `Publish time: ${new Date(sc.publish_time).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`,
      at:    sc.created_at,
    });
  }

  return events
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 12);
}

async function fetchUpcoming(): Promise<UpcomingPost[]> {
  const now = new Date().toISOString();
  const { data: rows, error } = await supabase
    .from("schedules")
    .select("id, publish_time, content_type, platform, content_id, status")
    .gte("publish_time", now)
    .in("status", ["scheduled", "publishing"])
    .order("publish_time", { ascending: true })
    .limit(5);

  if (error || !rows?.length) return [];

  const imgIds = rows.filter((r: any) => r.content_type === "image").map((r: any) => r.content_id);
  const vidIds = rows.filter((r: any) => r.content_type === "video").map((r: any) => r.content_id);

  const [imgR, vidR, charR] = await Promise.all([
    imgIds.length
      ? supabase.from("images").select("id, image_url, character_id").in("id", imgIds)
      : Promise.resolve({ data: [] as any[] }),
    vidIds.length
      ? supabase.from("videos").select("id, video_url, character_id").in("id", vidIds)
      : Promise.resolve({ data: [] as any[] }),
    supabase.from("characters").select("id, name, reference_image_url"),
  ]);

  const imgMap  = new Map((imgR.data  ?? []).map((i: any) => [i.id, i]));
  const vidMap  = new Map((vidR.data  ?? []).map((v: any) => [v.id, v]));
  const charMap = new Map((charR.data ?? []).map((c: any) => [c.id, c]));
  const PLACEHOLDER = "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&q=80";

  return rows.map((r: any): UpcomingPost => {
    const isVideo = r.content_type === "video";
    const src: any = isVideo ? vidMap.get(r.content_id) : imgMap.get(r.content_id);
    const char: any = src?.character_id ? charMap.get(src.character_id) : null;
    const media = isVideo ? src?.video_url : src?.image_url;
    return {
      id:          r.id,
      type:        r.content_type,
      character:   char?.name ?? "Lila",
      thumbnail:   char?.reference_image_url || media || PLACEHOLDER,
      scheduledAt: r.publish_time,
      platform:    r.platform ?? "Fanvue",
    };
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)    return `${Math.round(diff)}s ago`;
  if (diff < 3600)  return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

function formatScheduleTime(iso: string) {
  const d   = new Date(iso);
  const now = new Date();
  const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = d.getDate() === tomorrow.getDate() && d.getMonth() === tomorrow.getMonth() && d.getFullYear() === tomorrow.getFullYear();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday)    return `Today · ${time}`;
  if (isTomorrow) return `Tomorrow · ${time}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + ` · ${time}`;
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return " morning";
  if (h < 18) return " afternoon";
  return " evening";
}

const ACTIVITY_ICON: Record<ActivityKind, { icon: React.ElementType; color: string }> = {
  image_generated: { icon: ImageLucide,   color: "text-chart-2" },
  video_generated: { icon: Film,          color: "text-primary" },
  approved:        { icon: CheckCircle2,  color: "text-success" },
  rejected:        { icon: XCircle,       color: "text-destructive" },
  scheduled:       { icon: CalendarClock, color: "text-chart-4" },
  published:       { icon: CheckCircle2,  color: "text-success" },
  job_failed:      { icon: AlertTriangle, color: "text-destructive" },
};

// ─── Page ─────────────────────────────────────────────────────────────────────

function DashboardPage() {
  const { data } = useQuery({
    queryKey: ["dashboard", "stats"],
    queryFn:  fetchDashboardStats,
    staleTime: 30_000,
  });
  const { data: activity = [], isLoading: activityLoading } = useQuery({
    queryKey: ["dashboard", "activity"],
    queryFn:  fetchActivity,
    staleTime: 20_000,
  });
  const { data: upcoming = [], isLoading: upcomingLoading } = useQuery({
    queryKey: ["dashboard", "upcoming"],
    queryFn:  fetchUpcoming,
    staleTime: 20_000,
  });

  const stats = data ?? { images: 0, videos: 0, scheduled: 0, pending: 0, active: 0 };

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />
        <SidebarInset className="flex min-w-0 flex-1 flex-col">
          <AppHeader />
          <main className="flex-1">
            <div className="bg-aurora">
              <div className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8">

                {/* Heading */}
                <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Overview</p>
                    <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight md:text-4xl">
                      Good{getGreeting()}, Lila.
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Here&apos;s what your creator pipeline shipped today.
                    </p>
                  </div>
                  <div className="mt-4 flex items-center gap-2 md:mt-0">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-2.5 py-1 text-xs text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_8px_var(--success)]" />
                      All systems operational
                    </span>
                  </div>
                </div>

                {/* Stat cards */}
                <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  <DashboardCard label="Images generated" value={String(stats.images)}    hint="all time"              icon={ImageIcon}     accent="chart-2" />
                  <DashboardCard label="Videos generated" value={String(stats.videos)}    hint="all time"              icon={Video}         accent="primary" />
                  <DashboardCard label="Scheduled posts"  value={String(stats.scheduled)} hint="upcoming"              icon={CalendarClock} accent="chart-4" />
                  <DashboardCard
                    label="Pending reviews"
                    value={String(stats.pending)}
                    hint="awaiting approval"
                    icon={ClipboardCheck}
                    accent="chart-3"
                    // Subtle pulse on the card when there are pending items
                    delta={stats.pending > 0 ? stats.pending : undefined}
                  />
                  <DashboardCard label="Active jobs"      value={String(stats.active)}    hint="queued or processing"  icon={Cpu}           accent="chart-5" />
                </div>

                {/* Main grid */}
                <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <div className="lg:col-span-2">
                    <ActivityFeedPanel items={activity} isLoading={activityLoading} />
                  </div>
                  <div className="flex flex-col gap-4">
                    <QuickActionsPanel pending={stats.pending} />
                    <SchedulePanel items={upcoming} isLoading={upcomingLoading} />
                  </div>
                </div>

              </div>
            </div>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}

// ─── Activity Feed Panel ──────────────────────────────────────────────────────

function ActivityFeedPanel({ items, isLoading }: { items: ActivityItem[]; isLoading: boolean }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card">
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
        <div>
          <p className="text-sm font-semibold">Recent activity</p>
          <p className="text-xs text-muted-foreground">Latest pipeline events</p>
        </div>
        <Button asChild variant="ghost" size="sm" className="gap-1 text-xs text-muted-foreground">
          <Link to="/review">View all <ArrowRight className="h-3 w-3" /></Link>
        </Button>
      </div>
      <div className="divide-y divide-border/40">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 px-5 py-3.5">
              <div className="mt-0.5 h-7 w-7 animate-pulse rounded-full bg-muted" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-48 animate-pulse rounded bg-muted" />
                <div className="h-2.5 w-32 animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))
        ) : items.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-muted-foreground">No activity yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">Generate content to see events here.</p>
          </div>
        ) : (
          items.map((item) => {
            const { icon: Icon, color } = ACTIVITY_ICON[item.kind] ?? ACTIVITY_ICON.image_generated;
            return (
              <div key={item.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-muted/30 transition-colors">
                <div className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border/60 bg-background", color)}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{item.label}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.sub}</p>
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(item.at)}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Quick Actions Panel ──────────────────────────────────────────────────────

function QuickActionsPanel({ pending }: { pending: number }) {
  const actions = [
    { label: "Generate image",  sub: "New portrait or scene",          icon: ImageLucide,   to: "/generate", accent: "text-chart-2" },
    { label: "Generate video",  sub: "Send job to RunPod",             icon: Film,          to: "/generate", accent: "text-primary" },
    { label: "Schedule post",   sub: "Add to publishing queue",        icon: CalendarPlus,  to: "/schedule", accent: "text-chart-4" },
    {
      label: "Review queue",
      sub:   pending > 0 ? `${pending} item${pending !== 1 ? "s" : ""} pending` : "All clear",
      icon:  ClipboardCheck,
      to:    "/review",
      accent: pending > 0 ? "text-chart-3" : "text-muted-foreground",
    },
  ];

  return (
    <div className="rounded-xl border border-border/60 bg-card">
      <div className="border-b border-border/60 px-5 py-4">
        <p className="text-sm font-semibold">Quick actions</p>
        <p className="text-xs text-muted-foreground">Jump straight in</p>
      </div>
      <div className="divide-y divide-border/40">
        {actions.map((a) => (
          <Link key={a.label} to={a.to} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
            <div className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border/60 bg-background", a.accent)}>
              <a.icon className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{a.label}</p>
              <p className="text-xs text-muted-foreground">{a.sub}</p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
          </Link>
        ))}
      </div>
    </div>
  );
}
function SchedulePanel({ items, isLoading }: { items: UpcomingPost[]; isLoading: boolean }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card">
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
        <div>
          <p className="text-sm font-semibold">Upcoming schedule</p>
          <p className="text-xs text-muted-foreground">Next 48 hours</p>
        </div>
        <Button asChild variant="ghost" size="sm" className="gap-1 text-xs text-muted-foreground">
          <Link to="/schedule">Open calendar <ArrowRight className="h-3 w-3" /></Link>
        </Button>
      </div>
      <div className="divide-y divide-border/40">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3">
              <div className="h-9 w-9 animate-pulse rounded-md bg-muted" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-32 animate-pulse rounded bg-muted" />
                <div className="h-2.5 w-24 animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))
        ) : items.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-muted-foreground">Nothing scheduled yet.</p>
            <Button asChild size="sm" variant="outline" className="mt-3 gap-1.5">
              <Link to="/schedule"><CalendarPlus className="h-3.5 w-3.5" /> Schedule content</Link>
            </Button>
          </div>
        ) : (
          items.map((post) => (
            <Link key={post.id} to="/schedule" className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
              <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md border border-border/60 bg-muted">
                <img src={post.thumbnail} alt={post.character} className="h-full w-full object-cover" loading="lazy" />
                <div className="absolute right-0 bottom-0 grid h-3.5 w-3.5 place-items-center rounded-tl bg-background/80">
                  {post.type === "video"
                    ? <Video className="h-2 w-2 text-primary" />
                    : <ImageLucide className="h-2 w-2 text-chart-2" />}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{post.character}</p>
                <p className="text-xs text-muted-foreground">{post.platform} · {post.type}</p>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                {formatScheduleTime(post.scheduledAt)}
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Schedule Panel ───────────────────────────────────────────────────────────

