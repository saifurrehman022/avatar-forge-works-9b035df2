import { Sparkles, Video, CalendarPlus, ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const actions = [
  {
    title: "Generate image",
    desc: "New portrait or scene",
    icon: Sparkles,
    tone: "from-primary/20 to-primary/0 text-primary",
  },
  {
    title: "Generate video",
    desc: "Send job to RunPod",
    icon: Video,
    tone: "from-chart-2/20 to-chart-2/0 text-chart-2",
  },
  {
    title: "Schedule post",
    desc: "Add to publishing queue",
    icon: CalendarPlus,
    tone: "from-chart-4/20 to-chart-4/0 text-chart-4",
  },
  {
    title: "Review queue",
    desc: "12 items pending",
    icon: ClipboardCheck,
    tone: "from-success/20 to-success/0 text-success",
  },
];

export function QuickActions() {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-display text-base font-semibold">Quick actions</h3>
          <p className="text-xs text-muted-foreground">Jump straight in</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {actions.map((a) => (
          <button
            key={a.title}
            className="group relative overflow-hidden rounded-lg border border-border bg-background/40 p-4 text-left transition-all hover:border-primary/40 hover:bg-background"
          >
            <div
              className={cn(
                "pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br opacity-60 blur-2xl transition-opacity group-hover:opacity-100",
                a.tone,
              )}
            />
            <div className={cn("relative grid h-8 w-8 place-items-center rounded-md bg-gradient-to-br", a.tone)}>
              <a.icon className="h-4 w-4" />
            </div>
            <p className="relative mt-3 text-sm font-medium text-foreground">{a.title}</p>
            <p className="relative text-xs text-muted-foreground">{a.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
