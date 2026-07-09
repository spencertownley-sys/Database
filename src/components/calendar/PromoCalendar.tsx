"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { addMonths, addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SelectFilter } from "@/components/shared/FilterBar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  PROMO_STATUS_COLORS,
  PROMO_STATUS_LABELS,
  PROMO_STATUSES,
  OFFER_TYPES,
  OFFER_TYPE_LABELS,
  type PromoStatus,
  type OfferType,
} from "@/lib/constants";
import { cn, formatDate } from "@/lib/utils";
import type { CalendarPromo } from "@/db/queries/calendar";

interface PromoCalendarProps {
  promos: CalendarPromo[];
  from: string;
  to: string;
  mode: "month" | "quarter";
  anchor: string;
}

const DENSITY_THRESHOLD = 6; // lane rows above this = over-promoted

export function PromoCalendar({ promos, from, to, mode, anchor }: PromoCalendarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [laneBy, setLaneBy] = useState<"region" | "ship">("region");
  const [statusFilter, setStatusFilter] = useState("");
  const [offerFilter, setOfferFilter] = useState("");
  const [laneFilter, setLaneFilter] = useState("");

  const start = parseISO(from);
  const end = parseISO(to);
  const totalDays = differenceInCalendarDays(end, start) + 1;

  const filtered = useMemo(
    () =>
      promos.filter(
        (p) =>
          (!statusFilter || p.status === statusFilter) &&
          (!offerFilter || p.offer_type === offerFilter)
      ),
    [promos, statusFilter, offerFilter]
  );

  const lanes = useMemo(() => {
    const map = new Map<string, CalendarPromo[]>();
    for (const p of filtered) {
      const key =
        (laneBy === "region" ? p.region_name : p.ship_name) ?? "Unassigned";
      if (laneFilter && key !== laneFilter) continue;
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, laneBy, laneFilter]);

  const laneOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of filtered) {
      set.add((laneBy === "region" ? p.region_name : p.ship_name) ?? "Unassigned");
    }
    return Array.from(set).sort();
  }, [filtered, laneBy]);

  function navigate(direction: -1 | 1) {
    const next = addMonths(parseISO(anchor), direction * (mode === "quarter" ? 3 : 1));
    router.push(`${pathname}?mode=${mode}&anchor=${format(next, "yyyy-MM-dd")}`);
  }

  function setMode(m: string) {
    router.push(`${pathname}?mode=${m}&anchor=${anchor}`);
  }

  // Month boundary markers for the header
  const monthMarkers = useMemo(() => {
    const markers: { label: string; offsetPct: number; widthPct: number }[] = [];
    let cursor = start;
    while (cursor <= end) {
      const monthEnd = addDays(addMonths(new Date(cursor.getFullYear(), cursor.getMonth(), 1), 1), -1);
      const segEnd = monthEnd < end ? monthEnd : end;
      const offset = differenceInCalendarDays(cursor, start);
      const width = differenceInCalendarDays(segEnd, cursor) + 1;
      markers.push({
        label: format(cursor, "MMM yyyy"),
        offsetPct: (offset / totalDays) * 100,
        widthPct: (width / totalDays) * 100,
      });
      cursor = addDays(segEnd, 1);
    }
    return markers;
  }, [start, end, totalDays]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[140px] text-center text-sm font-medium">
            {mode === "quarter"
              ? `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`
              : format(start, "MMMM yyyy")}
          </span>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => navigate(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={mode} onValueChange={setMode}>
            <TabsList className="h-8">
              <TabsTrigger value="month" className="text-xs">Month</TabsTrigger>
              <TabsTrigger value="quarter" className="text-xs">Quarter</TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs value={laneBy} onValueChange={(v) => { setLaneBy(v as "region" | "ship"); setLaneFilter(""); }}>
            <TabsList className="h-8">
              <TabsTrigger value="region" className="text-xs">By region</TabsTrigger>
              <TabsTrigger value="ship" className="text-xs">By ship</TabsTrigger>
            </TabsList>
          </Tabs>
          <SelectFilter
            placeholder="All statuses"
            value={statusFilter}
            onChange={setStatusFilter}
            options={PROMO_STATUSES.map((s) => ({
              value: s,
              label: PROMO_STATUS_LABELS[s as PromoStatus],
            }))}
          />
          <SelectFilter
            placeholder="All offer types"
            value={offerFilter}
            onChange={setOfferFilter}
            options={OFFER_TYPES.map((t) => ({
              value: t,
              label: OFFER_TYPE_LABELS[t as OfferType],
            }))}
          />
          <SelectFilter
            placeholder={laneBy === "region" ? "All regions" : "All ships"}
            value={laneFilter}
            onChange={setLaneFilter}
            options={laneOptions.map((l) => ({ value: l, label: l }))}
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <div className="min-w-[720px]">
          {/* Month header */}
          <div className="relative h-8 border-b bg-muted/40">
            {monthMarkers.map((m) => (
              <div
                key={m.label}
                className="absolute top-0 flex h-full items-center border-l px-2 text-xs font-medium text-muted-foreground first:border-l-0"
                style={{ left: `${m.offsetPct}%`, width: `${m.widthPct}%` }}
              >
                {m.label}
              </div>
            ))}
          </div>

          {lanes.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">
              No promotions have sell windows in this period.
            </p>
          ) : (
            lanes.map(([lane, lanePromos]) => {
              const dense = lanePromos.length > DENSITY_THRESHOLD;
              return (
                <div key={lane} className="border-b last:border-0">
                  <div
                    className={cn(
                      "flex items-center gap-1.5 px-3 pb-1 pt-2 text-xs font-medium",
                      dense ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
                    )}
                  >
                    {lane}
                    <span className="font-normal">({lanePromos.length})</span>
                    {dense && (
                      <Tooltip>
                        <TooltipTrigger>
                          <AlertTriangle className="h-3.5 w-3.5" />
                        </TooltipTrigger>
                        <TooltipContent>
                          High promo density — {lanePromos.length} overlapping promos in this lane
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <div className="relative space-y-1 px-0 pb-2">
                    {lanePromos.map((p) => {
                      const pStart = parseISO(p.sell_start_date);
                      const pEnd = parseISO(p.sell_end_date);
                      const clampedStart = pStart < start ? start : pStart;
                      const clampedEnd = pEnd > end ? end : pEnd;
                      const offset = (differenceInCalendarDays(clampedStart, start) / totalDays) * 100;
                      const width = Math.max(
                        1.2,
                        ((differenceInCalendarDays(clampedEnd, clampedStart) + 1) / totalDays) * 100
                      );
                      const colors = PROMO_STATUS_COLORS[(p.status in PROMO_STATUS_LABELS ? p.status : "draft") as PromoStatus];
                      return (
                        <div key={p.id} className="relative h-6">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Link
                                href={`/promotions/${p.id}`}
                                className="absolute top-0 flex h-6 items-center overflow-hidden rounded px-1.5 text-[11px] font-medium text-white transition-opacity hover:opacity-80"
                                style={{
                                  left: `${offset}%`,
                                  width: `${width}%`,
                                  backgroundColor: colors.hex,
                                }}
                              >
                                <span className="truncate">{p.promo_name}</span>
                              </Link>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="space-y-0.5">
                                <p className="font-medium">{p.promo_name}</p>
                                <p className="text-xs">
                                  {PROMO_STATUS_LABELS[(p.status in PROMO_STATUS_LABELS ? p.status : "draft") as PromoStatus]} ·{" "}
                                  {formatDate(p.sell_start_date)} – {formatDate(p.sell_end_date)}
                                </p>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {PROMO_STATUSES.map((s) => (
          <span key={s} className="flex items-center gap-1">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: PROMO_STATUS_COLORS[s as PromoStatus].hex }}
            />
            {PROMO_STATUS_LABELS[s as PromoStatus]}
          </span>
        ))}
      </div>
    </div>
  );
}
