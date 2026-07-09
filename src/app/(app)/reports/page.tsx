import type { Metadata } from "next";
import { format, subMonths } from "date-fns";
import { PageShell } from "@/components/layout/PageShell";
import { ReportsClient } from "@/components/reports/ReportsClient";
import {
  promoPerformanceReport,
  revenueByOfferType,
  promoDensityByRegion,
  bookingLiftByMonth,
} from "@/db/queries/reports";
import { getCurrentProfile } from "@/lib/supabase/server";
import { USER_ROLES, type UserRole } from "@/lib/constants";
import {
  Card,
  CardContent,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const profile = await getCurrentProfile();
  const role = (profile?.role && profile.role in USER_ROLES
    ? profile.role
    : "viewer") as UserRole;

  if (!USER_ROLES[role].canViewReports) {
    return (
      <PageShell title="Reports" description="Performance analytics.">
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            Your role ({USER_ROLES[role].label}) doesn&apos;t include report access.
            Ask an admin if you need it.
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  const from = searchParams.from ?? format(subMonths(new Date(), 12), "yyyy-MM-dd");
  const to = searchParams.to ?? format(new Date(), "yyyy-MM-dd");

  const [performance, byOfferType, density, lift] = await Promise.all([
    promoPerformanceReport(from, to),
    revenueByOfferType(from, to),
    promoDensityByRegion(from, to),
    bookingLiftByMonth(from, to),
  ]);

  return (
    <PageShell
      title="Reports & analytics"
      description="Promotion performance, booking lift, and regional density."
    >
      <ReportsClient
        from={from}
        to={to}
        performance={performance}
        byOfferType={byOfferType}
        density={density}
        lift={lift}
      />
    </PageShell>
  );
}
