import { Suspense } from "react";
import Link from "next/link";
import {
  Radio,
  ClipboardCheck,
  AlertCircle,
  TrendingUp,
} from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { PromosByStatusChart } from "@/components/dashboard/PromosByStatusChart";
import { PromoCalendarStrip } from "@/components/dashboard/PromoCalendarStrip";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { PromoStatusBadge } from "@/components/promotions/PromoStatusBadge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  dashboardKpis,
  promosByStatus,
  recentActivity,
  topPromosThisMonth,
  promoCalendarStrip,
} from "@/db/queries/reports";
import { formatCurrency, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function DashboardContent() {
  const [kpis, byStatus, activity, topPromos, strip] = await Promise.all([
    dashboardKpis(),
    promosByStatus(),
    recentActivity(20),
    topPromosThisMonth(5),
    promoCalendarStrip(),
  ]);

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Active promos"
          value={formatNumber(kpis.live_promos)}
          icon={Radio}
          href="/promotions?status=live"
          hint="Currently live and bookable"
        />
        <KpiCard
          label="Pending approval"
          value={formatNumber(kpis.pending_approval)}
          icon={ClipboardCheck}
          href="/promotions?status=pending_approval"
          hint="Waiting for manager sign-off"
        />
        <KpiCard
          label="Voyages with no active promo"
          value={formatNumber(kpis.open_voyages_no_promo)}
          icon={AlertCircle}
          href="/voyages?noPromo=1"
          tone="warning"
          hint="Open future sailings uncovered"
        />
        <KpiCard
          label="Bookings this month"
          value={formatNumber(kpis.bookings_this_month)}
          icon={TrendingUp}
          href="/reports"
          hint="Attributed to promotions"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Calendar strip */}
        <Card className="xl:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-[15px]">Promo calendar</CardTitle>
            <CardDescription>
              Sell windows from 30 days back to 60 days ahead.{" "}
              <Link href="/calendar" className="text-primary hover:underline">
                Full calendar →
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PromoCalendarStrip promos={strip} />
          </CardContent>
        </Card>

        {/* Status chart */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-[15px]">Promos by status</CardTitle>
          </CardHeader>
          <CardContent>
            <PromosByStatusChart data={byStatus} />
          </CardContent>
        </Card>

        {/* Top performers */}
        <Card className="xl:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-[15px]">
              Top performing promos this month
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topPromos.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No performance data recorded this month yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Promotion</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Bookings</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topPromos.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Link
                          href={`/promotions/${p.id}`}
                          className="font-medium hover:text-primary hover:underline"
                        >
                          {p.promo_name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <PromoStatusBadge status={p.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(p.bookings)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(p.revenue)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Activity feed */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-[15px]">Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[420px] overflow-y-auto">
            <RecentActivity entries={activity} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-72 xl:col-span-2" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <PageShell
      title="Dashboard"
      description="What's happening across all promotions right now."
    >
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </PageShell>
  );
}
