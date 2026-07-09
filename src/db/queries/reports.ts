import { db } from "@/db";
import {
  promotions,
  promoPerformance,
  promoVoyages,
  voyages,
  regions,
  activityLog,
  profiles,
} from "@/db/schema";
import { and, eq, gte, lte, desc, sql, isNull } from "drizzle-orm";

/**
 * Promo-level performance rollup within a date range.
 * Uses promo-level aggregate rows (voyage_id IS NULL) to avoid double counting.
 */
export async function promoPerformanceReport(from: string, to: string) {
  return db
    .select({
      promoId: promotions.id,
      promoName: promotions.promoName,
      promoCode: promotions.promoCode,
      offerType: promotions.offerType,
      status: promotions.status,
      sellStartDate: promotions.sellStartDate,
      sellEndDate: promotions.sellEndDate,
      bookings: sql<number>`coalesce(sum(${promoPerformance.bookings}), 0)::int`,
      revenue: sql<string>`coalesce(sum(${promoPerformance.revenue}), 0)`,
      redemptions: sql<number>`coalesce(sum(${promoPerformance.redemptions}), 0)::int`,
      cancellations: sql<number>`coalesce(sum(${promoPerformance.cancellations}), 0)::int`,
      incrementalBookings: sql<number>`coalesce(sum(${promoPerformance.incrementalBookings}), 0)::int`,
    })
    .from(promoPerformance)
    .innerJoin(promotions, eq(promoPerformance.promoId, promotions.id))
    .where(
      and(
        isNull(promoPerformance.voyageId),
        gte(promoPerformance.periodEnd, from),
        lte(promoPerformance.periodStart, to)
      )
    )
    .groupBy(promotions.id)
    .orderBy(desc(sql`sum(${promoPerformance.revenue})`));
}

/** Revenue + bookings by offer type in range. */
export async function revenueByOfferType(from: string, to: string) {
  return db
    .select({
      offerType: promotions.offerType,
      revenue: sql<string>`coalesce(sum(${promoPerformance.revenue}), 0)`,
      bookings: sql<number>`coalesce(sum(${promoPerformance.bookings}), 0)::int`,
      promoCount: sql<number>`count(DISTINCT ${promotions.id})::int`,
    })
    .from(promoPerformance)
    .innerJoin(promotions, eq(promoPerformance.promoId, promotions.id))
    .where(
      and(
        isNull(promoPerformance.voyageId),
        gte(promoPerformance.periodEnd, from),
        lte(promoPerformance.periodStart, to)
      )
    )
    .groupBy(promotions.offerType)
    .orderBy(desc(sql`sum(${promoPerformance.revenue})`));
}

/**
 * Promo density by region: how many promos (overlapping the range) touch
 * voyages in each region.
 */
export async function promoDensityByRegion(from: string, to: string) {
  return db
    .select({
      regionId: regions.id,
      regionName: regions.name,
      regionCode: regions.code,
      promoCount: sql<number>`count(DISTINCT ${promotions.id})::int`,
      voyageCount: sql<number>`count(DISTINCT ${voyages.id})::int`,
    })
    .from(regions)
    .leftJoin(voyages, eq(voyages.regionId, regions.id))
    .leftJoin(promoVoyages, eq(promoVoyages.voyageId, voyages.id))
    .leftJoin(
      promotions,
      and(
        eq(promoVoyages.promoId, promotions.id),
        lte(promotions.sellStartDate, to),
        gte(promotions.sellEndDate, from)
      )
    )
    .groupBy(regions.id)
    .orderBy(desc(sql`count(DISTINCT ${promotions.id})`));
}

/** Monthly bookings trend: promo bookings vs estimated baseline (non-promo). */
export async function bookingLiftByMonth(from: string, to: string) {
  const rows = await db.execute<{
    month: string;
    bookings: number;
    incremental: number;
  }>(sql`
    SELECT to_char(date_trunc('month', period_start), 'YYYY-MM') AS month,
      sum(bookings)::int AS bookings,
      sum(coalesce(incremental_bookings, 0))::int AS incremental
    FROM promo_performance
    WHERE voyage_id IS NULL
      AND period_end >= ${from} AND period_start <= ${to}
    GROUP BY 1 ORDER BY 1
  `);
  return rows as unknown as { month: string; bookings: number; incremental: number }[];
}

// ---------------------------------------------------------------------------
// Dashboard queries
// ---------------------------------------------------------------------------
export async function dashboardKpis() {
  const [row] = (await db.execute<{
    live_promos: number;
    pending_approval: number;
    open_voyages_no_promo: number;
    bookings_this_month: number;
  }>(sql`
    SELECT
      (SELECT count(*) FROM promotions WHERE status = 'live')::int AS live_promos,
      (SELECT count(*) FROM promotions WHERE status = 'pending_approval')::int AS pending_approval,
      (SELECT count(*) FROM voyages v
        WHERE v.status = 'open'
        AND v.sail_date >= CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1 FROM promo_voyages pv
          JOIN promotions p ON pv.promo_id = p.id
          WHERE pv.voyage_id = v.id AND p.status IN ('approved', 'live', 'paused')
        ))::int AS open_voyages_no_promo,
      (SELECT coalesce(sum(bookings), 0) FROM promo_performance
        WHERE voyage_id IS NULL
        AND period_end >= date_trunc('month', CURRENT_DATE)
        AND period_start < date_trunc('month', CURRENT_DATE) + interval '1 month'
      )::int AS bookings_this_month
  `)) as unknown as {
    live_promos: number;
    pending_approval: number;
    open_voyages_no_promo: number;
    bookings_this_month: number;
  }[];
  return row;
}

export async function promosByStatus() {
  return db
    .select({
      status: promotions.status,
      count: sql<number>`count(*)::int`,
    })
    .from(promotions)
    .groupBy(promotions.status);
}

export async function recentActivity(limit = 20) {
  return db
    .select({
      entry: activityLog,
      performerName: profiles.fullName,
      entityName: sql<string | null>`CASE
        WHEN ${activityLog.entityType} = 'promotion'
          THEN (SELECT promo_name FROM promotions WHERE id = ${activityLog.entityId})
        WHEN ${activityLog.entityType} = 'voyage'
          THEN (SELECT voyage_code FROM voyages WHERE id = ${activityLog.entityId})
        WHEN ${activityLog.entityType} = 'disclaimer'
          THEN (SELECT name FROM disclaimers WHERE id = ${activityLog.entityId})
        ELSE NULL
      END`,
    })
    .from(activityLog)
    .leftJoin(profiles, eq(activityLog.performedBy, profiles.id))
    .orderBy(desc(activityLog.performedAt))
    .limit(limit);
}

export async function activityForEntity(
  entityType: string,
  entityId: string,
  limit = 50
) {
  return db
    .select({
      entry: activityLog,
      performerName: profiles.fullName,
    })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityType, entityType),
        eq(activityLog.entityId, entityId)
      )
    )
    .leftJoin(profiles, eq(activityLog.performedBy, profiles.id))
    .orderBy(desc(activityLog.performedAt))
    .limit(limit);
}

export async function topPromosThisMonth(limit = 5) {
  const rows = await db.execute<{
    id: string;
    promo_name: string;
    status: string;
    bookings: number;
    revenue: string;
  }>(sql`
    SELECT p.id, p.promo_name, p.status,
      sum(pp.bookings)::int AS bookings,
      sum(pp.revenue) AS revenue
    FROM promo_performance pp
    JOIN promotions p ON pp.promo_id = p.id
    WHERE pp.voyage_id IS NULL
      AND pp.period_end >= date_trunc('month', CURRENT_DATE)
      AND pp.period_start < date_trunc('month', CURRENT_DATE) + interval '1 month'
    GROUP BY p.id
    ORDER BY sum(pp.bookings) DESC
    LIMIT ${limit}
  `);
  return rows as unknown as {
    id: string;
    promo_name: string;
    status: string;
    bookings: number;
    revenue: string;
  }[];
}

/** Promos whose sell window overlaps the coming weeks, for the calendar strip. */
export async function promoCalendarStrip(daysBack = 30, daysForward = 60) {
  const rows = await db.execute<{
    id: string;
    promo_name: string;
    status: string;
    sell_start_date: string;
    sell_end_date: string;
  }>(sql`
    SELECT id, promo_name, status, sell_start_date, sell_end_date
    FROM promotions
    WHERE sell_start_date <= CURRENT_DATE + ${daysForward}::int
      AND sell_end_date >= CURRENT_DATE - ${daysBack}::int
      AND status NOT IN ('cancelled')
    ORDER BY sell_start_date
    LIMIT 60
  `);
  return rows as unknown as {
    id: string;
    promo_name: string;
    status: string;
    sell_start_date: string;
    sell_end_date: string;
  }[];
}
