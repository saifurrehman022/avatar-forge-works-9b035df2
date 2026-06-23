import { createFileRoute } from "@tanstack/react-router";
import {
  ImageIcon,
  Video,
  CalendarClock,
  ClipboardCheck,
  Cpu,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { AppHeader } from "@/components/dashboard/app-header";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { ScheduleWidget } from "@/components/dashboard/schedule-widget";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/")({
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

async function fetchDashboardStats() {
  const [imgs, vids, scheduled, pending, active] = await Promise.all([
    supabase.from("images").select("*", { count: "exact", head: true }),
    supabase.from("videos").select("*", { count: "exact", head: true }),
    supabase
      .from("schedules")
      .select("*", { count: "exact", head: true })
      .eq("status", "scheduled"),
    supabase
      .from("review_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("generation_jobs")
      .select("*", { count: "exact", head: true })
      .in("status", ["queued", "processing"]),
  ]);
  return {
    images: imgs.count ?? 0,
    videos: vids.count ?? 0,
    scheduled: scheduled.count ?? 0,
    pending: pending.count ?? 0,
    active: active.count ?? 0,
  };
}

function DashboardPage() {
  const { data } = useQuery({
    queryKey: ["dashboard", "stats"],
    queryFn: fetchDashboardStats,
    staleTime: 30_000,
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
                {/* Page heading */}
                <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      Overview
                    </p>
                    <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight md:text-4xl">
                      Good evening, Lila.
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
                  <DashboardCard
                    label="Images generated"
                    value={String(stats.images)}
                    hint="all time"
                    icon={ImageIcon}
                    accent="chart-2"
                  />
                  <DashboardCard
                    label="Videos generated"
                    value={String(stats.videos)}
                    hint="all time"
                    icon={Video}
                    accent="primary"
                  />
                  <DashboardCard
                    label="Scheduled posts"
                    value={String(stats.scheduled)}
                    hint="upcoming"
                    icon={CalendarClock}
                    accent="chart-4"
                  />
                  <DashboardCard
                    label="Pending reviews"
                    value={String(stats.pending)}
                    hint="awaiting approval"
                    icon={ClipboardCheck}
                    accent="chart-3"
                  />
                  <DashboardCard
                    label="Active jobs"
                    value={String(stats.active)}
                    hint="queued or processing"
                    icon={Cpu}
                    accent="chart-5"
                  />
                </div>

                {/* Main grid */}
                <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <div className="lg:col-span-2">
                    <ActivityFeed />
                  </div>
                  <div className="flex flex-col gap-4">
                    <QuickActions />
                    <ScheduleWidget />
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
