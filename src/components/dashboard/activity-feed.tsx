import {
  CheckCircle2,
  ImageIcon,
  Video,
  AlertTriangle,
  CalendarPlus,
  UserCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ActivityType = "image" | "video" | "review" | "schedule" | "character" | "alert";

interface Activity {
  id: string;
  type: ActivityType;
  title: string;
  meta: string;
  time: string;
}

const iconMap: Record<ActivityType, { icon: typeof ImageIcon; tone: string }> = {
  image: { icon: ImageIcon, tone: "bg-chart-2/15 text-chart-2" },
  video: { icon: Video, tone: "bg-primary/15 text-primary" },
  review: { icon: CheckCircle2, tone: "bg-success/15 text-success" },
  schedule: { icon: CalendarPlus, tone: "bg-chart-4/15 text-chart-4" },
  character: { icon: UserCircle2, tone: "bg-chart-3/15 text-chart-3" },
  alert: { icon: AlertTriangle, tone: "bg-destructive/15 text-destructive" },
};

const activities: Activity[] = [
  {
    id: "1",
    type: "image",
    title: "Generated 8 portraits · Lila — Studio Set",
    meta: "SDXL · seed 48201",
    time: "2m ago",
  },
  {
    id: "2",
    type: "review",
    title: "Approved 14 items in Review Queue",
    meta: "by you",
    time: "18m ago",
  },
  {
    id: "3",
    type: "video",
    title: "Rendered 6s clip · Golden hour walk",
    meta: "RunPod · A100 · 38s",
    time: "47m ago",
  },
  {
    id: "4",
    type: "schedule",
    title: "Scheduled 3 posts for Instagram",
    meta: "Tomorrow · 09:00, 12:30, 18:00",
    time: "1h ago",
  },
  {
    id: "5",
    type: "character",
    title: "Updated reference set · Lila v3.2",
    meta: "12 new refs · LoRA retrained",
    time: "3h ago",
  },
  {
    id: "6",
    type: "alert",
    title: "Job failed · CFG out of range",
    meta: "Retried automatically",
    time: "5h ago",
  },
];

export function ActivityFeed() {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h3 className="font-display text-base font-semibold">Recent activity</h3>
          <p className="text-xs text-muted-foreground">Latest pipeline events</p>
        </div>
        <button className="text-xs font-medium text-primary hover:underline">
          View all
        </button>
      </div>
      <ul className="divide-y divide-border">
        {activities.map((a) => {
          const { icon: Icon, tone } = iconMap[a.type];
          return (
            <li key={a.id} className="flex items-start gap-3 px-5 py-3.5">
              <div className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", tone)}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{a.title}</p>
                <p className="truncate text-xs text-muted-foreground">{a.meta}</p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{a.time}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
