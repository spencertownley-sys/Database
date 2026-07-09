import { db } from "@/db";
import {
  promotions,
  promoVoyages,
  promoDisclaimers,
  promoAudiences,
  profiles,
  voyages,
  disclaimers,
  audienceSegments,
} from "@/db/schema";
import {
  and,
  eq,
  gte,
  lte,
  desc,
  sql,
  inArray,
  arrayContains,
} from "drizzle-orm";

export interface PromoListFilters {
  status?: string;
  offerType?: string;
  ownerId?: string;
  sellFrom?: string; // promos whose sell window overlaps [sellFrom, sellTo]
  sellTo?: string;
  sailFrom?: string;
  sailTo?: string;
  regionId?: string; // via linked voyages
  shipId?: string; // via linked voyages
  tag?: string;
  q?: string; // full-text search
  limit?: number;
}

/**
 * List promotions with owner + link counts.
 * Sell-window overlap follows the pattern:
 *   sell_start_date <= :to AND sell_end_date >= :from
 */
export async function listPromotions(filters: PromoListFilters = {}) {
  const conditions = [];

  if (filters.status) conditions.push(eq(promotions.status, filters.status));
  if (filters.offerType)
    conditions.push(eq(promotions.offerType, filters.offerType));
  if (filters.ownerId) conditions.push(eq(promotions.ownerId, filters.ownerId));
  if (filters.sellFrom)
    conditions.push(gte(promotions.sellEndDate, filters.sellFrom));
  if (filters.sellTo)
    conditions.push(lte(promotions.sellStartDate, filters.sellTo));
  if (filters.sailFrom)
    conditions.push(
      sql`(${promotions.sailEndDate} IS NULL OR ${promotions.sailEndDate} >= ${filters.sailFrom})`
    );
  if (filters.sailTo)
    conditions.push(
      sql`(${promotions.sailStartDate} IS NULL OR ${promotions.sailStartDate} <= ${filters.sailTo})`
    );
  if (filters.tag) conditions.push(arrayContains(promotions.tags, [filters.tag]));
  if (filters.q) {
    conditions.push(
      sql`(promotions.search_vector @@ plainto_tsquery('english', ${filters.q})
        OR ${promotions.promoName} ILIKE ${"%" + filters.q + "%"}
        OR ${promotions.promoCode} ILIKE ${"%" + filters.q + "%"})`
    );
  }
  if (filters.regionId || filters.shipId) {
    const voyageCond = [];
    if (filters.regionId) voyageCond.push(eq(voyages.regionId, filters.regionId));
    if (filters.shipId) voyageCond.push(eq(voyages.shipId, filters.shipId));
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${promoVoyages}
        JOIN ${voyages} ON ${promoVoyages.voyageId} = ${voyages.id}
        WHERE ${promoVoyages.promoId} = ${promotions.id}
        AND ${and(...voyageCond)})`
    );
  }

  const rows = await db
    .select({
      promo: promotions,
      ownerName: profiles.fullName,
      voyageCount: sql<number>`(SELECT count(*)::int FROM ${promoVoyages} WHERE ${promoVoyages.promoId} = ${promotions.id})`,
      disclaimerCount: sql<number>`(SELECT count(*)::int FROM ${promoDisclaimers} WHERE ${promoDisclaimers.promoId} = ${promotions.id})`,
      audienceCount: sql<number>`(SELECT count(*)::int FROM ${promoAudiences} WHERE ${promoAudiences.promoId} = ${promotions.id})`,
    })
    .from(promotions)
    .leftJoin(profiles, eq(promotions.ownerId, profiles.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(promotions.sellStartDate), desc(promotions.createdAt))
    .limit(filters.limit ?? 1000);

  return rows;
}

export async function getPromotion(id: string) {
  const promo = await db.query.promotions.findFirst({
    where: eq(promotions.id, id),
    with: {
      owner: true,
      approver: true,
      promoDisclaimers: { with: { disclaimer: true } },
      promoAudiences: { with: { segment: true } },
    },
  });
  if (!promo) return null;

  const [counts] = await db
    .select({
      voyageCount: sql<number>`count(*)::int`,
    })
    .from(promoVoyages)
    .where(eq(promoVoyages.promoId, id));

  return { ...promo, voyageCount: counts?.voyageCount ?? 0 };
}

/** Voyages linked to a promo, with ship + region names. */
export async function getLinkedVoyages(promoId: string) {
  return db.query.promoVoyages.findMany({
    where: eq(promoVoyages.promoId, promoId),
    with: {
      voyage: { with: { ship: true, region: true } },
    },
    orderBy: (pv, { asc }) => [asc(pv.addedAt)],
  });
}

/** All owners for the filter dropdown. */
export async function listOwners() {
  return db
    .select({ id: profiles.id, fullName: profiles.fullName })
    .from(profiles)
    .orderBy(profiles.fullName);
}

/** Distinct tags in use, for the tag filter. */
export async function listPromoTags(): Promise<string[]> {
  const rows = await db.execute<{ tag: string }>(
    sql`SELECT DISTINCT unnest(tags) AS tag FROM promotions WHERE tags IS NOT NULL ORDER BY tag`
  );
  return (rows as unknown as { tag: string }[]).map((r) => r.tag);
}

export async function listApprovedDisclaimers() {
  return db
    .select()
    .from(disclaimers)
    .where(inArray(disclaimers.status, ["approved", "draft"]))
    .orderBy(disclaimers.name, desc(disclaimers.version));
}

export async function listAudienceSegments() {
  return db.select().from(audienceSegments).orderBy(audienceSegments.name);
}
