import { db } from "@/db";
import {
  voyages,
  ships,
  regions,
  promoVoyages,
  promotions,
  promoPerformance,
} from "@/db/schema";
import { and, eq, gte, lte, desc, asc, sql } from "drizzle-orm";
import { ACTIVE_PROMO_STATUSES } from "@/lib/constants";

export interface VoyageListFilters {
  shipId?: string;
  regionId?: string;
  from?: string;
  to?: string;
  duration?: number;
  status?: string;
  minOccupancy?: number;
  maxOccupancy?: number;
  noActivePromo?: boolean;
  q?: string;
  limit?: number;
}

const activePromoCountSql = sql<number>`(
  SELECT count(*)::int FROM ${promoVoyages}
  JOIN ${promotions} ON ${promoVoyages.promoId} = ${promotions.id}
  WHERE ${promoVoyages.voyageId} = ${voyages.id}
  AND ${promotions.status} IN ('approved', 'live', 'paused')
)`;

export async function listVoyages(filters: VoyageListFilters = {}) {
  const conditions = [];
  if (filters.shipId) conditions.push(eq(voyages.shipId, filters.shipId));
  if (filters.regionId) conditions.push(eq(voyages.regionId, filters.regionId));
  if (filters.from) conditions.push(gte(voyages.sailDate, filters.from));
  if (filters.to) conditions.push(lte(voyages.sailDate, filters.to));
  if (filters.duration)
    conditions.push(eq(voyages.durationNights, filters.duration));
  if (filters.status) conditions.push(eq(voyages.status, filters.status));
  if (filters.minOccupancy !== undefined)
    conditions.push(
      sql`${voyages.occupancyPercent} >= ${filters.minOccupancy}`
    );
  if (filters.maxOccupancy !== undefined)
    conditions.push(
      sql`${voyages.occupancyPercent} <= ${filters.maxOccupancy}`
    );
  if (filters.q)
    conditions.push(
      sql`(${voyages.voyageCode} ILIKE ${"%" + filters.q + "%"} OR ${voyages.itineraryName} ILIKE ${"%" + filters.q + "%"})`
    );
  if (filters.noActivePromo) conditions.push(sql`${activePromoCountSql} = 0`);

  return db
    .select({
      voyage: voyages,
      shipName: ships.name,
      shipClass: ships.shipClass,
      regionName: regions.name,
      regionCode: regions.code,
      activePromoCount: activePromoCountSql,
    })
    .from(voyages)
    .innerJoin(ships, eq(voyages.shipId, ships.id))
    .leftJoin(regions, eq(voyages.regionId, regions.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(voyages.sailDate))
    .limit(filters.limit ?? 500);
}

export async function getVoyage(id: string) {
  return db.query.voyages.findFirst({
    where: eq(voyages.id, id),
    with: { ship: true, region: true },
  });
}

/**
 * Every promotion ever linked to a voyage — past, current, and future.
 * The query the promo team could never run before.
 */
export async function getPromosForVoyage(voyageId: string) {
  return db
    .select({
      link: promoVoyages,
      promo: promotions,
    })
    .from(promoVoyages)
    .innerJoin(promotions, eq(promoVoyages.promoId, promotions.id))
    .where(eq(promoVoyages.voyageId, voyageId))
    .orderBy(desc(promotions.sellStartDate));
}

export async function getVoyagePerformance(voyageId: string) {
  return db
    .select()
    .from(promoPerformance)
    .where(eq(promoPerformance.voyageId, voyageId))
    .orderBy(asc(promoPerformance.periodStart));
}

export async function listShips() {
  return db
    .select({
      ship: ships,
      voyageCount: sql<number>`(SELECT count(*)::int FROM voyages v WHERE v.ship_id = ships.id)`,
    })
    .from(ships)
    .orderBy(asc(ships.name));
}

export async function listRegions() {
  return db.select().from(regions).orderBy(asc(regions.name));
}

export { ACTIVE_PROMO_STATUSES };
