import { NextRequest, NextResponse } from "next/server";
import {
  promoPerformanceReport,
  revenueByOfferType,
  promoDensityByRegion,
  bookingLiftByMonth,
} from "@/db/queries/reports";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const from = p.get("from") ?? "2025-01-01";
  const to = p.get("to") ?? "2027-12-31";
  try {
    const [performance, byOfferType, densityByRegion, liftByMonth] =
      await Promise.all([
        promoPerformanceReport(from, to),
        revenueByOfferType(from, to),
        promoDensityByRegion(from, to),
        bookingLiftByMonth(from, to),
      ]);
    return NextResponse.json({ performance, byOfferType, densityByRegion, liftByMonth });
  } catch (err) {
    console.error("reports failed", err);
    return NextResponse.json({ error: "Failed to load reports" }, { status: 500 });
  }
}
