"use client";

import { useState, useTransition } from "react";
import { DAYS_OF_WEEK, STATUS_CYCLE, STATUS_META, TIME_BLOCKS } from "@/lib/constants";
import type { AvailabilityStatus, WeeklyGrid as WeeklyGridType } from "@/types";
import { cn } from "@/lib/utils";

export function WeeklyGrid({
  grid,
  onCellChange,
}: {
  grid: WeeklyGridType;
  onCellChange: (dayOfWeek: number, timeBlock: string, status: AvailabilityStatus) => Promise<unknown>;
}) {
  const [optimistic, setOptimistic] = useState<WeeklyGridType>(grid);
  const [, startTransition] = useTransition();

  function cycle(day: number, block: string) {
    const current = optimistic[day]?.[block as keyof (typeof optimistic)[number]] ?? "unavailable";
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(current) + 1) % STATUS_CYCLE.length];

    setOptimistic((prev) => ({
      ...prev,
      [day]: { ...prev[day], [block]: next },
    }));
    startTransition(() => {
      onCellChange(day, block, next);
    });
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
                const status: AvailabilityStatus =
                  optimistic[day.value]?.[block.value] ?? "unavailable";
                const meta = STATUS_META[status];
                return (
                  <button
                    key={`${day.value}-${block.value}`}
                    type="button"
                    onClick={() => cycle(day.value, block.value)}
                    title={`${day.label} ${block.label}: ${meta.label} — click to change`}
                    className={cn(
                      "h-11 rounded-md text-[11px] font-medium transition-colors sm:h-12",
                      meta.cellClass
                    )}
                  >
                    <span className="sr-only">
                      {day.label} {block.label}: {meta.label}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <Legend />
    </div>
  );
}

export function Legend() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      {STATUS_CYCLE.map((status) => (
        <div key={status} className="flex items-center gap-1.5">
          <span className={cn("h-3 w-3 rounded-sm", STATUS_META[status].dotClass)} />
          {STATUS_META[status].label}
        </div>
      ))}
      <span className="text-muted-foreground/70">Tap a square to cycle through statuses</span>
    </div>
  );
}
