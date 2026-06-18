import { Instagram, Youtube, AtSign, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScheduleItem {
  id: string;
  title: string;
  platform: "instagram" | "tiktok" | "youtube";
  type: "Reel" | "Post" | "Short" | "Story";
  when: string;
  day: "Today" | "Tomorrow" | string;
}

const platformMap = {
  instagram: { icon: Instagram, tone: "bg-chart-4/15 text-chart-4", label: "Instagram" },
  tiktok: { icon: AtSign, tone: "bg-primary/15 text-primary", label: "TikTok" },
  youtube: { icon: Youtube, tone: "bg-destructive/15 text-destructive", label: "YouTube" },
};

const items: ScheduleItem[] = [
  { id: "1", title: "Sunset balcony · carousel", platform: "instagram", type: "Post", when: "09:00", day: "Today" },
  { id: "2", title: "Coffee POV · 18s", platform: "tiktok", type: "Reel", when: "12:30", day: "Today" },
  { id: "3", title: "Outfit reveal · short", platform: "youtube", type: "Short", when: "18:00", day: "Today" },
  { id: "4", title: "Studio BTS · story drop", platform: "instagram", type: "Story", when: "08:15", day: "Tomorrow" },
  { id: "5", title: "City walk · 24s", platform: "tiktok", type: "Reel", when: "14:00", day: "Tomorrow" },
];

export function ScheduleWidget() {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h3 className="font-display text-base font-semibold">Upcoming schedule</h3>
          <p className="text-xs text-muted-foreground">Next 48 hours</p>
        </div>
        <button className="text-xs font-medium text-primary hover:underline">
          Open calendar
        </button>
      </div>
      <ul className="divide-y divide-border">
        {items.map((it) => {
          const { icon: Icon, tone, label } = platformMap[it.platform];
          return (
            <li key={it.id} className="flex items-center gap-3 px-5 py-3.5">
              <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", tone)}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{it.title}</p>
                <p className="text-xs text-muted-foreground">
                  {label} · {it.type}
                </p>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-xs font-medium text-foreground">{it.day}</span>
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {it.when}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
