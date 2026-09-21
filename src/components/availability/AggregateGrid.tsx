import { DAYS_OF_WEEK, TIME_BLOCKS } from "@/lib/constants";
import type { AggregateGrid as AggregateGridType } from "@/types";
import { cn } from "@/lib/utils";

/** Heat intensity: share of the band that's fully available in that slot. */
function heatClass(pctAvailable: number, total: number): string {
  if (total === 0) return "bg-secondary";
  if (pctAvailable === 0) return "bg-secondary";
  if (pctAvailable < 0.34) return "bg-primary/20";
  if (pctAvailable < 0.67) return "bg-primary/50";
  if (pctAvailable < 1) return "bg-primary/75";
  return "bg-primary text-primary-foreground";
}

export function AggregateGrid({ grid, memberCount }: { grid: AggregateGridType; memberCount: number }) {
  if (memberCount === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Share your band&apos;s link to start collecting availability.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[80px_repeat(7,1fr)] gap-1.5">
          <div />
          {DAYS_OF_WEEK.map((day) => (
            <div key={day.value} className="pb-1 text-center text-xs font-medium text-muted-foreground">
              {day.short}
            </div>
          ))}
          {TIME_BLOCKS.map((block) => (
            <div key={block.value} className="contents">
              <div className="flex flex-col justify-center pr-2 text-right text-xs font-medium text-muted-foreground">
                {block.label}
              </div>
              {DAYS_OF_WEEK.map((day) => {
                const counts = grid[day.value]?.[block.value];
                const total = counts?.total ?? 0;
                const available = counts?.available ?? 0;
                const maybe = counts?.maybe ?? 0;
                const pct = total > 0 ? available / total : 0;
                return (
                  <div
                    key={`${day.value}-${block.value}`}
                    title={`${day.label} ${block.label}: ${available} available, ${maybe} maybe, of ${total}`}
                    className={cn(
                      "flex h-11 items-center justify-center rounded-md text-[11px] font-semibold sm:h-12",
                      heatClass(pct, total)
                    )}
                  >
                    {total > 0 ? `${available}/${total}` : ""}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Each square shows how many of your {memberCount} member{memberCount === 1 ? "" : "s"} are
        available. Darker means more of the band is free.
      </p>
    </div>
  );
}
