"use client";

import { useState } from "react";
import { AVAILABILITY_STATUSES, STATUS_META, formatTimeSlot, generateTimeSlots } from "@/lib/constants";
import type { AvailabilityStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";

const DEMO_DATES = [
  { key: "fri", label: "Fri", sub: "9/26" },
  { key: "sat", label: "Sat", sub: "9/27" },
  { key: "sun", label: "Sun", sub: "9/28" },
  { key: "tue", label: "Tue", sub: "9/30" },
  { key: "wed", label: "Wed", sub: "10/1" },
] as const;

const DEMO_SLOTS = generateTimeSlots("17:00", "21:00", 60);

// A deterministic, opinionated seed so the marketing hero always looks lively.
const SEED: Record<string, AvailabilityStatus> = {
  "fri-18:00": "available",
  "fri-19:00": "preferred",
  "sat-17:00": "maybe",
  "sat-18:00": "available",
  "sat-19:00": "available",
  "sat-20:00": "conflict",
  "sun-17:00": "maybe",
  "sun-18:00": "preferred",
  "tue-18:00": "conflict",
  "tue-19:00": "maybe",
  "wed-19:00": "available",
  "wed-20:00": "preferred",
};

export function LandingGridPreview() {
  const [grid, setGrid] = useState(SEED);
  const [active, setActive] = useState<AvailabilityStatus>("available");

  function setCell(key: string) {
    setGrid((prev) => ({ ...prev, [key]: active }));
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-semibold">The Basement Tapes — Fall Tour</p>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
          Try it — tap a square
        </span>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {AVAILABILITY_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setActive(status)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
              active === status ? cn(STATUS_META[status].cellClass, "border-transparent") : "hover:bg-muted"
            )}
          >
            {STATUS_META[status].label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-[70px_repeat(5,1fr)] gap-1.5">
            <div />
            {DEMO_DATES.map((d) => (
              <div key={d.key} className="pb-1 text-center text-[11px] font-medium text-muted-foreground">
                <div>{d.label}</div>
                <div className="text-[10px] opacity-70">{d.sub}</div>
              </div>
            ))}
            {DEMO_SLOTS.map((slot) => (
              <div key={slot} className="contents">
                <div className="flex items-center justify-end pr-2 text-[11px] font-medium text-muted-foreground">
                  {formatTimeSlot(slot)}
                </div>
                {DEMO_DATES.map((d) => {
                  const key = `${d.key}-${slot}`;
                  const status = grid[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setCell(key)}
                      className={cn(
                        "h-9 rounded-md transition-colors sm:h-10",
                        status ? STATUS_META[status].cellClass : "bg-secondary hover:bg-muted"
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
