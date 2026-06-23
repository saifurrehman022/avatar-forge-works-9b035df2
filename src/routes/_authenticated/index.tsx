import { createFileRoute } from "@tanstack/react-router";
import {
  ImageIcon,
  Video,
  CalendarClock,
  ClipboardCheck,
  Cpu,
} from "lucide-react";

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { AppHeader } from "@/components/dashboard/app-header";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { ScheduleWidget } from "@/components/dashboard/schedule-widget";
import { QuickActions } from "@/components/dashboard/quick-actions";

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

function DashboardPage() {
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
                    value="2,481"
                    delta={12.4}
                    hint="vs last week"
                    icon={ImageIcon}
                    accent="chart-2"
                  />
                  <DashboardCard
                    label="Videos generated"
                    value="318"
                    delta={8.1}
                    hint="vs last week"
                    icon={Video}
                    accent="primary"
                  />
                  <DashboardCard
                    label="Scheduled posts"
                    value="46"
                    delta={-3.2}
                    hint="next 7 days"
                    icon={CalendarClock}
                    accent="chart-4"
                  />
                  <DashboardCard
                    label="Pending reviews"
                    value="12"
                    hint="awaiting approval"
                    icon={ClipboardCheck}
                    accent="chart-3"
                  />
                  <DashboardCard
                    label="Active jobs"
                    value="7"
                    hint="2 queued · 5 running"
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
