"use client";

import { useState } from "react";
import { DAYS_OF_WEEK, STATUS_CYCLE, STATUS_META, TIME_BLOCKS } from "@/lib/constants";
import type { AvailabilityStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";

// A deterministic, opinionated seed so the marketing hero always looks lively.
const SEED: Record<string, AvailabilityStatus> = {
  "1-evening": "available",
  "2-evening": "maybe",
  "3-evening": "available",
  "4-evening": "unavailable",
  "5-evening": "maybe",
  "6-afternoon": "available",
  "6-evening": "available",
  "0-afternoon": "maybe",
  "1-afternoon": "unavailable",
  "2-afternoon": "available",
  "3-afternoon": "maybe",
  "4-afternoon": "available",
  "5-afternoon": "available",
  "0-evening": "unavailable",
};

export function LandingGridPreview() {
  const [grid, setGrid] = useState(SEED);

  function cycle(key: string) {
    const current = grid[key] ?? "unavailable";
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(current) + 1) % STATUS_CYCLE.length];
    setGrid((prev) => ({ ...prev, [key]: next }));
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-semibold">The Basement Tapes — this week</p>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
          Try it — tap a square
        </span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-[70px_repeat(7,1fr)] gap-1.5">
            <div />
            {DAYS_OF_WEEK.map((day) => (
              <div key={day.value} className="pb-1 text-center text-[11px] font-medium text-muted-foreground">
                {day.short}
              </div>
            ))}
            {TIME_BLOCKS.map((block) => (
              <div key={block.value} className="contents">
                <div className="flex items-center justify-end pr-2 text-[11px] font-medium text-muted-foreground">
                  {block.label}
                </div>
                {DAYS_OF_WEEK.map((day) => {
                  const key = `${day.value}-${block.value}`;
                  const status = grid[key] ?? "unavailable";
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => cycle(key)}
                      className={cn(
                        "h-9 rounded-md transition-colors sm:h-10",
                        STATUS_META[status].cellClass
                      )}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
