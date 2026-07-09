"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, SortableHeader } from "@/components/shared/DataTable";
import {
  FilterBar,
  SelectFilter,
  DateFilter,
} from "@/components/shared/FilterBar";
import { BulkActions } from "@/components/shared/BulkActions";
import { PromoStatusBadge } from "@/components/promotions/PromoStatusBadge";
import { usePromoFilters } from "@/hooks/usePromoFilters";
import { useDebounce } from "@/hooks/useDebounce";
import {
  OFFER_TYPES,
  OFFER_TYPE_LABELS,
  PROMO_STATUSES,
  PROMO_STATUS_LABELS,
  type OfferType,
  type PromoStatus,
} from "@/lib/constants";
import { formatDate, toCsv, downloadCsv } from "@/lib/utils";
import type { Promotion } from "@/types";

export interface PromoListRow {
  promo: Promotion;
  ownerName: string | null;
  voyageCount: number;
  disclaimerCount: number;
  audienceCount: number;
}

interface PromoListClientProps {
  rows: PromoListRow[];
  owners: { id: string; fullName: string }[];
  tags: string[];
  ships: { id: string; name: string }[];
  regions: { id: string; name: string }[];
  canCreate: boolean;
  canApprove: boolean;
}

export function PromoListClient({
  rows,
  owners,
  tags,
  ships,
  regions,
  canCreate,
  canApprove,
}: PromoListClientProps) {
  const router = useRouter();
  const { get, setFilters, clearFilters, searchParams } = usePromoFilters();
  const [selected, setSelected] = useState<PromoListRow[]>([]);
  const [search, setSearch] = useState(get("q"));
  const debouncedSearch = useDebounce(search, 350);

  useEffect(() => {
    if (debouncedSearch !== get("q")) {
      setFilters({ q: debouncedSearch || null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  // Cmd+N → new promo
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "n" && (e.metaKey || e.ctrlKey) && canCreate) {
        e.preventDefault();
        router.push("/promotions/new");
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [router, canCreate]);

  const columns = useMemo<ColumnDef<PromoListRow>[]>(
    () => [
      {
        id: "select",
        size: 32,
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && "indeterminate")
            }
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(!!v)}
            onClick={(e) => e.stopPropagation()}
            aria-label="Select row"
          />
        ),
        enableSorting: false,
      },
      {
        id: "name",
        accessorFn: (r) => r.promo.promoName,
        header: ({ column }) => <SortableHeader column={column}>Promotion</SortableHeader>,
        cell: ({ row }) => (
          <div className="flex min-w-0 max-w-[320px] flex-col">
            <Link
              href={`/promotions/${row.original.promo.id}`}
              className="truncate font-medium hover:text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {row.original.promo.promoName}
            </Link>
            <span className="truncate text-xs text-muted-foreground">
              {row.original.promo.promoCode ?? "—"}
            </span>
          </div>
        ),
      },
      {
        id: "status",
        accessorFn: (r) => r.promo.status,
        header: ({ column }) => <SortableHeader column={column}>Status</SortableHeader>,
        cell: ({ row }) => <PromoStatusBadge status={row.original.promo.status} />,
      },
      {
        id: "offer",
        accessorFn: (r) => r.promo.offerValue,
        header: "Offer",
        cell: ({ row }) => (
          <div className="flex max-w-[220px] flex-col">
            <span className="truncate">{row.original.promo.offerValue}</span>
            <span className="text-xs text-muted-foreground">
              {OFFER_TYPE_LABELS[row.original.promo.offerType as OfferType] ??
                row.original.promo.offerType}
            </span>
          </div>
        ),
      },
      {
        id: "sellStart",
        accessorFn: (r) => r.promo.sellStartDate,
        header: ({ column }) => <SortableHeader column={column}>Sell window</SortableHeader>,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs">
            {formatDate(row.original.promo.sellStartDate)} –{" "}
            {formatDate(row.original.promo.sellEndDate)}
          </span>
        ),
      },
      {
        id: "voyages",
        accessorFn: (r) => r.voyageCount,
        header: ({ column }) => <SortableHeader column={column}>Voyages</SortableHeader>,
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.voyageCount}</span>
        ),
      },
      {
        id: "owner",
        accessorFn: (r) => r.ownerName ?? "",
        header: ({ column }) => <SortableHeader column={column}>Owner</SortableHeader>,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs">
            {row.original.ownerName ?? "—"}
          </span>
        ),
      },
      {
        id: "priority",
        accessorFn: (r) => r.promo.priority,
        header: "Priority",
        cell: ({ row }) => (
          <span className="text-xs capitalize text-muted-foreground">
            {row.original.promo.priority}
          </span>
        ),
      },
    ],
    []
  );

  function exportCsv() {
    const csv = toCsv(
      rows.map((r) => ({
        name: r.promo.promoName,
        code: r.promo.promoCode ?? "",
        status: r.promo.status,
        offer_type: r.promo.offerType,
        offer_value: r.promo.offerValue,
        sell_start: r.promo.sellStartDate,
        sell_end: r.promo.sellEndDate,
        voyages: r.voyageCount,
        owner: r.ownerName ?? "",
        priority: r.promo.priority ?? "",
        markets: (r.promo.market ?? []).join("; "),
        channels: (r.promo.bookingChannels ?? []).join("; "),
        tags: (r.promo.tags ?? []).join("; "),
      }))
    );
    downloadCsv("promotions.csv", csv);
  }

  const hasFilters = Array.from(searchParams.keys()).length > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, code, notes, tags…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-8"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          {canCreate && (
            <Button size="sm" asChild>
              <Link href="/promotions/new">
                <Plus className="h-4 w-4" />
                New promotion
              </Link>
            </Button>
          )}
        </div>
      </div>

      <FilterBar hasFilters={hasFilters} onClear={() => { setSearch(""); clearFilters(); }}>
        <SelectFilter
          placeholder="All statuses"
          value={get("status")}
          onChange={(v) => setFilters({ status: v || null })}
          options={PROMO_STATUSES.map((s) => ({
            value: s,
            label: PROMO_STATUS_LABELS[s as PromoStatus],
          }))}
        />
        <SelectFilter
          placeholder="All offer types"
          value={get("offerType")}
          onChange={(v) => setFilters({ offerType: v || null })}
          options={OFFER_TYPES.map((t) => ({
            value: t,
            label: OFFER_TYPE_LABELS[t as OfferType],
          }))}
        />
        <SelectFilter
          placeholder="All regions"
          value={get("region")}
          onChange={(v) => setFilters({ region: v || null })}
          options={regions.map((r) => ({ value: r.id, label: r.name }))}
        />
        <SelectFilter
          placeholder="All ships"
          value={get("ship")}
          onChange={(v) => setFilters({ ship: v || null })}
          options={ships.map((s) => ({ value: s.id, label: s.name }))}
        />
        <SelectFilter
          placeholder="All owners"
          value={get("owner")}
          onChange={(v) => setFilters({ owner: v || null })}
          options={owners.map((o) => ({ value: o.id, label: o.fullName }))}
        />
        <SelectFilter
          placeholder="All tags"
          value={get("tag")}
          onChange={(v) => setFilters({ tag: v || null })}
          options={tags.map((t) => ({ value: t, label: t }))}
        />
        <DateFilter
          label="Selling from"
          value={get("sellFrom")}
          onChange={(v) => setFilters({ sellFrom: v || null })}
        />
        <DateFilter
          label="to"
          value={get("sellTo")}
          onChange={(v) => setFilters({ sellTo: v || null })}
        />
      </FilterBar>

      {selected.length > 0 && (
        <BulkActions
          selectedIds={selected.map((r) => r.promo.id)}
          canApprove={canApprove}
        />
      )}

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.promo.id}
        onSelectionChange={setSelected}
        onRowClick={(r) => router.push(`/promotions/${r.promo.id}`)}
        emptyState={
          <div className="space-y-2 py-6">
            <p>No promotions match these filters.</p>
            {canCreate && (
              <Button variant="outline" size="sm" asChild>
                <Link href="/promotions/new">Create your first promotion</Link>
              </Button>
            )}
          </div>
        }
      />
    </div>
  );
}
