"use client";

import Link from "next/link";
import { addDays, differenceInCalendarDays, format, parseISO, startOfDay } from "date-fns";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  PROMO_STATUS_COLORS,
  PROMO_STATUS_LABELS,
  type PromoStatus,
} from "@/lib/constants";
import { formatDate } from "@/lib/utils";

interface StripPromo {
  id: string;
  promo_name: string;
  status: string;
  sell_start_date: string;
  sell_end_date: string;
}

interface PromoCalendarStripProps {
  promos: StripPromo[];
  daysBack?: number;
  daysForward?: number;
}

export function PromoCalendarStrip({
  promos,
  daysBack = 30,
  daysForward = 60,
}: PromoCalendarStripProps) {
  const today = startOfDay(new Date());
  const start = addDays(today, -daysBack);
  const end = addDays(today, daysForward);
  const totalDays = differenceInCalendarDays(end, start) + 1;
  const todayPct = (daysBack / totalDays) * 100;

  const rows = promos.slice(0, 18);

  return (
    <div className="relative">
      <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{format(start, "MMM d")}</span>
        <span className="font-medium text-primary">Today</span>
        <span>{format(end, "MMM d")}</span>
      </div>
      <div className="relative space-y-1 rounded-md border bg-muted/20 p-2">
        {/* today marker */}
        <div
          className="absolute bottom-0 top-0 z-10 w-px bg-primary/60"
          style={{ left: `${todayPct}%` }}
        />
        {rows.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No promos with sell windows in this period.
          </p>
        )}
        {rows.map((p) => {
          const pStart = parseISO(p.sell_start_date);
          const pEnd = parseISO(p.sell_end_date);
          const clampedStart = pStart < start ? start : pStart;
          const clampedEnd = pEnd > end ? end : pEnd;
          const offset = (differenceInCalendarDays(clampedStart, start) / totalDays) * 100;
          const width = Math.max(
            1.5,
            ((differenceInCalendarDays(clampedEnd, clampedStart) + 1) / totalDays) * 100
          );
          const status = (p.status in PROMO_STATUS_LABELS ? p.status : "draft") as PromoStatus;
          return (
            <div key={p.id} className="relative h-5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={`/promotions/${p.id}`}
                    className="absolute top-0 flex h-5 items-center overflow-hidden rounded px-1.5 text-[10px] font-medium text-white hover:opacity-80"
                    style={{
                      left: `${offset}%`,
                      width: `${width}%`,
                      backgroundColor: PROMO_STATUS_COLORS[status].hex,
                    }}
                  >
                    <span className="truncate">{p.promo_name}</span>
                  </Link>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-medium">{p.promo_name}</p>
                  <p className="text-xs">
                    {PROMO_STATUS_LABELS[status]} · {formatDate(p.sell_start_date)} –{" "}
                    {formatDate(p.sell_end_date)}
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </div>
  );
}
