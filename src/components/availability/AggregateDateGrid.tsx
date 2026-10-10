import { format, parseISO } from "date-fns";
import { AVAILABILITY_STATUSES, STATUS_META, UNFILLED_META, formatTimeSlot } from "@/lib/constants";
import type { AggregateGrid, DateColumn, SlotCounts } from "@/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const NAME_KEY = {
  conflict: "conflictNames",
  maybe: "maybeNames",
  available: "availableNames",
  preferred: "preferredNames",
} as const;

function dominant(counts: SlotCounts): "conflict" | "maybe" | "available" | "preferred" | null {
  let best: "conflict" | "maybe" | "available" | "preferred" | null = null;
  let bestCount = 0;
  for (const status of AVAILABILITY_STATUSES) {
    if (counts[status] > bestCount) {
      best = status;
      bestCount = counts[status];
    }
  }
  return best;
}

export function AggregateDateGrid({
  grid,
  dateColumns,
  timeSlots,
  memberCount,
}: {
  grid: AggregateGrid;
  dateColumns: DateColumn[];
  timeSlots: string[];
  memberCount: number;
}) {
  if (memberCount === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Share your invite link to start collecting availability.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <div
        className="grid"
        style={{ gridTemplateColumns: `120px repeat(${dateColumns.length}, minmax(64px, 1fr))` }}
      >
        <div className="sticky left-0 z-10 border-b border-r bg-card" />
        {dateColumns.map((col) => (
          <div
            key={col.date}
            className="flex flex-col items-center justify-center border-b border-l bg-card px-1 py-1.5 text-center text-[11px] font-medium text-muted-foreground"
          >
            <span>{format(parseISO(col.date), "EEE")}</span>
            <span>{format(parseISO(col.date), "M/d")}</span>
            {col.label && (
              <span className="mt-0.5 rounded bg-primary/10 px-1 text-[10px] font-semibold text-primary">
                {col.label}
              </span>
            )}
          </div>
        ))}

        {timeSlots.map((slot) => (
          <div key={slot} className="contents">
            <div className="sticky left-0 z-10 flex items-center justify-end border-b border-r bg-card px-2 py-2 text-right text-[11px] font-medium text-muted-foreground">
              {formatTimeSlot(slot)}
            </div>
            {dateColumns.map((col) => {
              const counts = grid[col.date]?.[slot];
              if (!counts) {
                return (
                  <div key={`${col.date}-${slot}`} className={cn("h-10 border-b border-l", UNFILLED_META.cellClass)} />
                );
              }
              const best = dominant(counts);
              const meta = best ? STATUS_META[best] : UNFILLED_META;
              return (
                <Popover key={`${col.date}-${slot}`}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "flex h-10 flex-col border-b border-l text-[9px] font-semibold transition-colors",
                        meta.cellClass
                      )}
                      title={`${format(parseISO(col.date), "EEE, MMM d")} ${formatTimeSlot(slot)}`}
                    >
                      <StackedBar counts={counts} memberCount={memberCount} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 space-y-2" align="center">
                    <p className="text-sm font-semibold">
                      {format(parseISO(col.date), "EEE, MMM d")} — {formatTimeSlot(slot)}
                    </p>
                    {[...AVAILABILITY_STATUSES].reverse().map((status) => {
                      const names = counts[NAME_KEY[status]];
                      if (names.length === 0) return null;
                      return (
                        <div key={status} className="text-xs">
                          <div className="mb-0.5 flex items-center gap-1.5 font-medium">
                            <span className={cn("h-2.5 w-2.5 rounded-full", STATUS_META[status].dotClass)} />
                            {STATUS_META[status].label} ({names.length})
                          </div>
                          <p className="pl-4 text-muted-foreground">{names.join(", ")}</p>
                        </div>
                      );
                    })}
                    {counts.unfilledNames.length > 0 && (
                      <div className="text-xs">
                        <div className="mb-0.5 flex items-center gap-1.5 font-medium">
                          <span className={cn("h-2.5 w-2.5 rounded-full", UNFILLED_META.dotClass)} />
                          {UNFILLED_META.label} ({counts.unfilledNames.length})
                        </div>
                        <p className="pl-4 text-muted-foreground">{counts.unfilledNames.join(", ")}</p>
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A thin proportional stacked bar of the 4 statuses (+ unfilled) for this cell. */
function StackedBar({ counts, memberCount }: { counts: SlotCounts; memberCount: number }) {
  const segments: { key: string; count: number; cls: string }[] = [
    { key: "preferred", count: counts.preferred, cls: STATUS_META.preferred.dotClass },
    { key: "available", count: counts.available, cls: STATUS_META.available.dotClass },
    { key: "maybe", count: counts.maybe, cls: STATUS_META.maybe.dotClass },
    { key: "conflict", count: counts.conflict, cls: STATUS_META.conflict.dotClass },
    { key: "unfilled", count: counts.unfilled, cls: UNFILLED_META.dotClass },
  ];

  return (
    <div className="flex h-full w-full overflow-hidden">
      {segments
        .filter((s) => s.count > 0)
        .map((s) => (
          <div
            key={s.key}
            className={cn(s.cls)}
            style={{ width: `${(s.count / memberCount) * 100}%` }}
          />
        ))}
    </div>
  );
}
