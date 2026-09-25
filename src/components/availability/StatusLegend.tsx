import { AVAILABILITY_STATUSES, STATUS_META, UNFILLED_META } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function StatusLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-4 text-xs text-muted-foreground", className)}>
      {AVAILABILITY_STATUSES.map((status) => (
        <div key={status} className="flex items-center gap-1.5">
          <span className={cn("h-3 w-3 rounded-sm", STATUS_META[status].dotClass)} />
          {STATUS_META[status].label}
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <span className={cn("h-3 w-3 rounded-sm", UNFILLED_META.dotClass)} />
        {UNFILLED_META.label}
      </div>
    </div>
  );
}
