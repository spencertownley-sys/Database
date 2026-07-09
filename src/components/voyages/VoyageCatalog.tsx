"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { LayoutGrid, Rows3, TagIcon, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, SortableHeader } from "@/components/shared/DataTable";
import { FilterBar, SelectFilter, DateFilter } from "@/components/shared/FilterBar";
import { VoyageCard } from "@/components/voyages/VoyageCard";
import { usePromoFilters } from "@/hooks/usePromoFilters";
import { useDebounce } from "@/hooks/useDebounce";
import { formatDate, formatPercent } from "@/lib/utils";
import { VOYAGE_STATUSES } from "@/lib/constants";
import { useEffect } from "react";
import type { Voyage } from "@/types";

export interface VoyageCatalogRow {
  voyage: Voyage;
  shipName: string;
  regionName: string | null;
  activePromoCount: number;
}

interface VoyageCatalogProps {
  rows: VoyageCatalogRow[];
  ships: { id: string; name: string }[];
  regions: { id: string; name: string }[];
}

const DURATIONS = [3, 4, 5, 6, 7, 8, 10, 12, 14];

export function VoyageCatalog({ rows, ships, regions }: VoyageCatalogProps) {
  const router = useRouter();
  const { get, setFilters, clearFilters, searchParams } = usePromoFilters();
  const [view, setView] = useState<"table" | "cards">("table");
  const [search, setSearch] = useState(get("q"));
  const debouncedSearch = useDebounce(search, 350);

  useEffect(() => {
    if (debouncedSearch !== get("q")) setFilters({ q: debouncedSearch || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const columns = useMemo<ColumnDef<VoyageCatalogRow>[]>(
    () => [
      {
        id: "code",
        accessorFn: (r) => r.voyage.voyageCode,
        header: ({ column }) => <SortableHeader column={column}>Voyage</SortableHeader>,
        cell: ({ row }) => (
          <div className="flex min-w-0 max-w-[280px] flex-col">
            <Link
              href={`/voyages/${row.original.voyage.id}`}
              className="truncate font-medium hover:text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {row.original.voyage.voyageCode}
            </Link>
            <span className="truncate text-xs text-muted-foreground">
              {row.original.voyage.itineraryName}
            </span>
          </div>
        ),
      },
      {
        id: "ship",
        accessorFn: (r) => r.shipName,
        header: ({ column }) => <SortableHeader column={column}>Ship</SortableHeader>,
        cell: ({ row }) => <span className="whitespace-nowrap text-xs">{row.original.shipName}</span>,
      },
      {
        id: "region",
        accessorFn: (r) => r.regionName ?? "",
        header: "Region",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {row.original.regionName ?? "—"}
          </span>
        ),
      },
      {
        id: "sailDate",
        accessorFn: (r) => r.voyage.sailDate,
        header: ({ column }) => <SortableHeader column={column}>Sails</SortableHeader>,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs">
            {formatDate(row.original.voyage.sailDate)}
          </span>
        ),
      },
      {
        id: "nights",
        accessorFn: (r) => r.voyage.durationNights,
        header: ({ column }) => <SortableHeader column={column}>Nights</SortableHeader>,
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.voyage.durationNights}</span>
        ),
      },
      {
        id: "occupancy",
        accessorFn: (r) => Number(r.voyage.occupancyPercent ?? 0),
        header: ({ column }) => <SortableHeader column={column}>Occupancy</SortableHeader>,
        cell: ({ row }) => {
          const occ = Number(row.original.voyage.occupancyPercent ?? 0);
          return (
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full ${occ >= 80 ? "bg-emerald-500" : occ >= 50 ? "bg-blue-500" : "bg-amber-500"}`}
                  style={{ width: `${Math.min(100, occ)}%` }}
                />
              </div>
              <span className="text-xs tabular-nums">{formatPercent(occ)}</span>
            </div>
          );
        },
      },
      {
        id: "status",
        accessorFn: (r) => r.voyage.status,
        header: "Status",
        cell: ({ row }) => (
          <Badge variant="outline" className="text-xs capitalize">
            {row.original.voyage.status}
          </Badge>
        ),
      },
      {
        id: "promos",
        accessorFn: (r) => r.activePromoCount,
        header: ({ column }) => <SortableHeader column={column}>Active promos</SortableHeader>,
        cell: ({ row }) =>
          row.original.activePromoCount === 0 ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
              <AlertCircle className="h-3 w-3" />
              No promo
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs tabular-nums">
              <TagIcon className="h-3 w-3 text-muted-foreground" />
              {row.original.activePromoCount}
            </span>
          ),
      },
    ],
    []
  );

  const hasFilters = Array.from(searchParams.keys()).length > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          placeholder="Search voyage code or itinerary…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-full max-w-xs"
        />
        <div className="flex items-center gap-1 rounded-md border p-0.5">
          <Button
            variant={view === "table" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2"
            onClick={() => setView("table")}
          >
            <Rows3 className="h-4 w-4" />
          </Button>
          <Button
            variant={view === "cards" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2"
            onClick={() => setView("cards")}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <FilterBar hasFilters={hasFilters} onClear={() => { setSearch(""); clearFilters(); }}>
        <SelectFilter
          placeholder="All ships"
          value={get("ship")}
          onChange={(v) => setFilters({ ship: v || null })}
          options={ships.map((s) => ({ value: s.id, label: s.name }))}
        />
        <SelectFilter
          placeholder="All regions"
          value={get("region")}
          onChange={(v) => setFilters({ region: v || null })}
          options={regions.map((r) => ({ value: r.id, label: r.name }))}
        />
        <SelectFilter
          placeholder="Any duration"
          value={get("duration")}
          onChange={(v) => setFilters({ duration: v || null })}
          options={DURATIONS.map((d) => ({ value: String(d), label: `${d} nights` }))}
        />
        <SelectFilter
          placeholder="All statuses"
          value={get("status")}
          onChange={(v) => setFilters({ status: v || null })}
          options={VOYAGE_STATUSES.map((s) => ({ value: s, label: s }))}
        />
        <SelectFilter
          placeholder="Any occupancy"
          value={get("maxOcc")}
          onChange={(v) => setFilters({ maxOcc: v || null })}
          options={[
            { value: "40", label: "< 40% booked" },
            { value: "60", label: "< 60% booked" },
            { value: "80", label: "< 80% booked" },
          ]}
        />
        <label className="flex cursor-pointer items-center gap-1.5 text-xs">
          <Checkbox
            checked={get("noPromo") === "1"}
            onCheckedChange={(c) => setFilters({ noPromo: c ? "1" : null })}
          />
          No active promo only
        </label>
        <DateFilter
          label="Sailing"
          value={get("from")}
          onChange={(v) => setFilters({ from: v || null })}
        />
        <DateFilter
          label="to"
          value={get("to")}
          onChange={(v) => setFilters({ to: v || null })}
        />
      </FilterBar>

      {view === "table" ? (
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(r) => r.voyage.id}
          onRowClick={(r) => router.push(`/voyages/${r.voyage.id}`)}
          pageSize={50}
          emptyState="No voyages match these filters."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.length === 0 ? (
            <p className="col-span-full py-12 text-center text-sm text-muted-foreground">
              No voyages match these filters.
            </p>
          ) : (
            rows.slice(0, 120).map((r) => <VoyageCard key={r.voyage.id} row={r} />)
          )}
        </div>
      )}
    </div>
  );
}
