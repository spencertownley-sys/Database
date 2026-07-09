"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { TrendingUp, TrendingDown } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DataTable, SortableHeader } from "@/components/shared/DataTable";
import { PromoStatusBadge } from "@/components/promotions/PromoStatusBadge";
import { OFFER_TYPE_LABELS, type OfferType } from "@/lib/constants";
import { formatCurrency, formatNumber, formatPercent, formatDate } from "@/lib/utils";

export interface PerformanceRow {
  promoId: string;
  promoName: string;
  promoCode: string | null;
  offerType: string;
  status: string;
  sellStartDate: string;
  sellEndDate: string;
  bookings: number;
  revenue: string;
  redemptions: number;
  cancellations: number;
  incrementalBookings: number;
}

export function PerformanceTable({ rows }: { rows: PerformanceRow[] }) {
  const columns = useMemo<ColumnDef<PerformanceRow>[]>(
    () => [
      {
        id: "promo",
        accessorFn: (r) => r.promoName,
        header: ({ column }) => <SortableHeader column={column}>Promotion</SortableHeader>,
        cell: ({ row }) => (
          <div className="flex max-w-[280px] flex-col">
            <Link
              href={`/promotions/${row.original.promoId}`}
              className="truncate font-medium hover:text-primary hover:underline"
            >
              {row.original.promoName}
            </Link>
            <span className="text-xs text-muted-foreground">
              {OFFER_TYPE_LABELS[row.original.offerType as OfferType] ?? row.original.offerType}
              {" · "}
              {formatDate(row.original.sellStartDate)} – {formatDate(row.original.sellEndDate)}
            </span>
          </div>
        ),
      },
      {
        id: "status",
        accessorFn: (r) => r.status,
        header: "Status",
        cell: ({ row }) => <PromoStatusBadge status={row.original.status} />,
      },
      {
        id: "bookings",
        accessorFn: (r) => r.bookings,
        header: ({ column }) => <SortableHeader column={column}>Bookings</SortableHeader>,
        cell: ({ row }) => (
          <span className="tabular-nums">{formatNumber(row.original.bookings)}</span>
        ),
      },
      {
        id: "revenue",
        accessorFn: (r) => Number(r.revenue),
        header: ({ column }) => <SortableHeader column={column}>Revenue</SortableHeader>,
        cell: ({ row }) => (
          <span className="tabular-nums">{formatCurrency(row.original.revenue)}</span>
        ),
      },
      {
        id: "redemptions",
        accessorFn: (r) => r.redemptions,
        header: ({ column }) => <SortableHeader column={column}>Redemptions</SortableHeader>,
        cell: ({ row }) => (
          <span className="tabular-nums">{formatNumber(row.original.redemptions)}</span>
        ),
      },
      {
        id: "cancelRate",
        accessorFn: (r) => (r.bookings > 0 ? r.cancellations / r.bookings : 0),
        header: ({ column }) => <SortableHeader column={column}>Cancel rate</SortableHeader>,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.bookings > 0
              ? formatPercent((row.original.cancellations / row.original.bookings) * 100, 1)
              : "—"}
          </span>
        ),
      },
      {
        id: "avgValue",
        accessorFn: (r) => (r.bookings > 0 ? Number(r.revenue) / r.bookings : 0),
        header: ({ column }) => <SortableHeader column={column}>Avg booking</SortableHeader>,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.bookings > 0
              ? formatCurrency(Number(row.original.revenue) / row.original.bookings)
              : "—"}
          </span>
        ),
      },
      {
        id: "lift",
        accessorFn: (r) => r.incrementalBookings,
        header: ({ column }) => <SortableHeader column={column}>Est. lift</SortableHeader>,
        cell: ({ row }) => (
          <span className="tabular-nums">
            +{formatNumber(row.original.incrementalBookings)}
          </span>
        ),
      },
    ],
    []
  );

  const top = useMemo(
    () => [...rows].sort((a, b) => b.bookings - a.bookings).slice(0, 5),
    [rows]
  );
  const bottom = useMemo(
    () =>
      [...rows]
        .filter((r) => r.bookings > 0)
        .sort((a, b) => a.bookings - b.bookings)
        .slice(0, 5),
    [rows]
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-[15px]">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              Top performers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RankList rows={top} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-[15px]">
              <TrendingDown className="h-4 w-4 text-red-500" />
              Bottom performers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RankList rows={bottom} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-[15px]">Promo performance</CardTitle>
          <CardDescription>
            All promotions with recorded performance in the selected period ({rows.length}).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={rows}
            getRowId={(r) => r.promoId}
            pageSize={25}
            emptyState="No performance data in this period."
          />
        </CardContent>
      </Card>
    </div>
  );
}

function RankList({ rows }: { rows: PerformanceRow[] }) {
  if (rows.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">No data.</p>;
  }
  return (
    <ol className="space-y-1.5">
      {rows.map((r, i) => (
        <li key={r.promoId} className="flex items-center justify-between gap-2 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">
              {i + 1}.
            </span>
            <Link
              href={`/promotions/${r.promoId}`}
              className="truncate font-medium hover:text-primary hover:underline"
            >
              {r.promoName}
            </Link>
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatNumber(r.bookings)} bookings · {formatCurrency(r.revenue)}
          </span>
        </li>
      ))}
    </ol>
  );
}
