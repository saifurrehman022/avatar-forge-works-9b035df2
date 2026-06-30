
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Sparkles,
  Library,
  ClipboardCheck,
  CalendarClock,
  UserCircle2,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const nav = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Content Generation", url: "/generate", icon: Sparkles },
  { title: "Content Library", url: "/library", icon: Library },
  { title: "Review Queue", url: "/review", icon: ClipboardCheck, badge: 12 },
  { title: "Scheduling", url: "/schedule", icon: CalendarClock },
  { title: "Character Manager", url: "/characters", icon: UserCircle2 },
];

export const AppSidebar = () => {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const pathname = useRouterState({
    select: (s) => s.location.pathname,
  });

  const isActive = (url: string) =>
    url === "/" ? pathname === "/" : pathname.startsWith(url);

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <div className="relative grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-primary to-chart-4">
            <span className="font-display text-sm font-bold text-primary-foreground">
              L
            </span>
          </div>

          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="font-display text-sm font-semibold tracking-tight">
                Lila Studio
              </span>
              <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Creator OS
              </span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>

          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.url)}
                    tooltip={item.title}
                  >
                    <Link to={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>

                      {!collapsed && item.badge && (
                        <span className="ml-auto rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        {!collapsed && (
          <div className="mx-2 mb-2 mt-1 rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-3">
            <p className="text-[11px] font-medium text-foreground">
              Pipeline online
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              RunPod · 3 workers idle
            </p>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
};

