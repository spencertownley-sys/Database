"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Download } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ChartTooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PerformanceTable } from "@/components/reports/PerformanceTable";
import { OFFER_TYPE_LABELS, type OfferType } from "@/lib/constants";
import { formatNumber, toCsv, downloadCsv, cn } from "@/lib/utils";
import type { PerformanceRow } from "@/components/reports/PerformanceTable";

// Validated 2-series palette (passes CVD/contrast checks light+dark)
const SERIES_BLUE = "#2563eb";
const SERIES_AMBER = "#d97706";

interface OfferTypeRow {
  offerType: string;
  revenue: string;
  bookings: number;
  promoCount: number;
}

interface DensityRow {
  regionId: string;
  regionName: string;
  regionCode: string;
  promoCount: number;
  voyageCount: number;
}

interface LiftRow {
  month: string;
  bookings: number;
  incremental: number;
}

interface ReportsClientProps {
  from: string;
  to: string;
  performance: PerformanceRow[];
  byOfferType: OfferTypeRow[];
  density: DensityRow[];
  lift: LiftRow[];
}

const tooltipStyle = {
  fontSize: 12,
  borderRadius: 8,
  background: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  color: "hsl(var(--popover-foreground))",
};

export function ReportsClient({
  from,
  to,
  performance,
  byOfferType,
  density,
  lift,
}: ReportsClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [fromInput, setFromInput] = useState(from);
  const [toInput, setToInput] = useState(to);

  const offerTypeData = useMemo(
    () =>
      byOfferType.map((r) => ({
        name: OFFER_TYPE_LABELS[r.offerType as OfferType] ?? r.offerType,
        revenue: Math.round(Number(r.revenue) / 1_000_000 * 10) / 10, // $M
        bookings: r.bookings,
      })),
    [byOfferType]
  );

  const liftData = useMemo(
    () =>
      lift.map((r) => ({
        month: r.month,
        "Promo bookings": r.bookings,
        "Estimated baseline": Math.max(0, r.bookings - r.incremental),
      })),
    [lift]
  );

  const maxDensity = Math.max(1, ...density.map((d) => d.promoCount));

  function applyRange() {
    router.push(`${pathname}?from=${fromInput}&to=${toInput}`);
  }

  function exportAll() {
    downloadCsv(
      `promo-performance-${from}-to-${to}.csv`,
      toCsv(
        performance.map((p) => ({
          promo: p.promoName,
          code: p.promoCode ?? "",
          offer_type: p.offerType,
          status: p.status,
          sell_start: p.sellStartDate,
          sell_end: p.sellEndDate,
          bookings: p.bookings,
          revenue: p.revenue,
          redemptions: p.redemptions,
          cancellations: p.cancellations,
          incremental_bookings: p.incrementalBookings,
        }))
      )
    );
  }

  return (
    <div className="space-y-4">
      {/* Date range + export */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-xs text-muted-foreground">Period</span>
          <Input
            type="date"
            value={fromInput}
            onChange={(e) => setFromInput(e.target.value)}
            className="h-8 w-[150px] text-xs"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={toInput}
            onChange={(e) => setToInput(e.target.value)}
            className="h-8 w-[150px] text-xs"
          />
          <Button size="sm" variant="outline" className="h-8" onClick={applyRange}>
            Apply
          </Button>
        </div>
        <Button size="sm" variant="outline" onClick={exportAll}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Revenue by offer type */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-[15px]">Revenue by offer type</CardTitle>
            <CardDescription>Promo-attributed revenue ($M) in period</CardDescription>
          </CardHeader>
          <CardContent>
            {offerTypeData.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No performance data in this period.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={offerTypeData} layout="vertical" margin={{ left: 40, right: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v) => `$${v}M`}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={130}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <ChartTooltip
                    contentStyle={tooltipStyle}
                    formatter={(v, name) =>
                      name === "revenue"
                        ? [`$${v}M`, "Revenue"]
                        : [formatNumber(Number(v ?? 0)), String(name ?? "")]
                    }
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                  />
                  <Bar dataKey="revenue" fill={SERIES_BLUE} radius={[0, 4, 4, 0]} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Booking lift */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-[15px]">Booking lift analysis</CardTitle>
            <CardDescription>
              Total promo bookings vs estimated non-promo baseline, by month
            </CardDescription>
          </CardHeader>
          <CardContent>
            {liftData.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No performance data in this period.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={liftData} margin={{ right: 24, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v) => formatNumber(v)}
                    axisLine={false}
                    tickLine={false}
                  />
                  <ChartTooltip
                    contentStyle={tooltipStyle}
                    formatter={(v) => formatNumber(Number(v ?? 0))}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    type="monotone"
                    dataKey="Promo bookings"
                    stroke={SERIES_BLUE}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="Estimated baseline"
                    stroke={SERIES_AMBER}
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Density heatmap */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-[15px]">Promo density by region</CardTitle>
          <CardDescription>
            Promotions touching each region in period — spot over- and
            under-promoted regions. Darker = more promos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {density.map((d) => {
              const intensity = d.promoCount / maxDensity;
              return (
                <div
                  key={d.regionId}
                  className="rounded-md border p-2.5"
                  style={{
                    // Sequential single-hue ramp: light→dark blue by promo count
                    backgroundColor: `color-mix(in oklab, ${SERIES_BLUE} ${Math.round(intensity * 82)}%, transparent)`,
                  }}
                >
                  <p
                    className={cn(
                      "truncate text-[11px] font-medium",
                      intensity > 0.55 ? "text-white" : "text-foreground"
                    )}
                  >
                    {d.regionName}
                  </p>
                  <p
                    className={cn(
                      "text-lg font-semibold tabular-nums",
                      intensity > 0.55 ? "text-white" : "text-foreground"
                    )}
                  >
                    {d.promoCount}
                  </p>
                  <p
                    className={cn(
                      "text-[10px]",
                      intensity > 0.55 ? "text-white/80" : "text-muted-foreground"
                    )}
                  >
                    {formatNumber(d.voyageCount)} voyages
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Performance table with top/bottom */}
      <PerformanceTable rows={performance} />
    </div>
  );
}
