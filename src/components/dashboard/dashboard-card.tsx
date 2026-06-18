import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DashboardCardProps {
  label: string;
  value: string | number;
  delta?: number; // percentage, can be negative
  hint?: string;
  icon: LucideIcon;
  accent?: "primary" | "chart-2" | "chart-3" | "chart-4" | "chart-5";
}

const accentMap: Record<NonNullable<DashboardCardProps["accent"]>, string> = {
  primary: "from-primary/25 to-primary/0 text-primary",
  "chart-2": "from-chart-2/25 to-chart-2/0 text-chart-2",
  "chart-3": "from-chart-3/25 to-chart-3/0 text-chart-3",
  "chart-4": "from-chart-4/25 to-chart-4/0 text-chart-4",
  "chart-5": "from-chart-5/25 to-chart-5/0 text-chart-5",
};

export function DashboardCard({
  label,
  value,
  delta,
  hint,
  icon: Icon,
  accent = "primary",
}: DashboardCardProps) {
  const positive = (delta ?? 0) >= 0;
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40">
      <div
        className={cn(
          "pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br blur-2xl opacity-60",
          accentMap[accent],
        )}
      />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 font-display text-3xl font-semibold tracking-tight text-foreground">
            {value}
          </p>
        </div>
        <div
          className={cn(
            "grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br",
            accentMap[accent],
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="relative mt-4 flex items-center gap-2 text-xs">
        {typeof delta === "number" && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium",
              positive
                ? "bg-success/15 text-success"
                : "bg-destructive/15 text-destructive",
            )}
          >
            {positive ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {Math.abs(delta)}%
          </span>
        )}
        {hint && <span className="text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}
