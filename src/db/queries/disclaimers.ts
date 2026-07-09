import { db } from "@/db";
import { disclaimers, promoDisclaimers, promotions } from "@/db/schema";
import { asc, desc, eq, sql } from "drizzle-orm";

export async function listDisclaimers(q?: string) {
  const where = q
    ? sql`(${disclaimers.name} ILIKE ${"%" + q + "%"} OR ${disclaimers.disclaimerText} ILIKE ${"%" + q + "%"})`
    : undefined;

  return db
    .select({
      disclaimer: disclaimers,
      usageCount: sql<number>`(
        SELECT count(*)::int FROM promo_disclaimers pd
        JOIN promotions p ON pd.promo_id = p.id
        WHERE pd.disclaimer_id = disclaimers.id
        AND p.status IN ('approved', 'live', 'paused')
      )`,
    })
    .from(disclaimers)
    .where(where)
    .orderBy(asc(disclaimers.name), desc(disclaimers.version));
}

export async function getDisclaimer(id: string) {
  return db.query.disclaimers.findFirst({ where: eq(disclaimers.id, id) });
}

/** Other versions sharing the same name. */
export async function getDisclaimerVersions(name: string) {
  return db
    .select()
    .from(disclaimers)
    .where(eq(disclaimers.name, name))
    .orderBy(desc(disclaimers.version));
}

/** Promotions currently using a disclaimer. */
export async function getPromosUsingDisclaimer(disclaimerId: string) {
  return db
    .select({
      id: promotions.id,
      promoName: promotions.promoName,
      status: promotions.status,
      sellStartDate: promotions.sellStartDate,
      sellEndDate: promotions.sellEndDate,
    })
    .from(promoDisclaimers)
    .innerJoin(promotions, eq(promoDisclaimers.promoId, promotions.id))
    .where(eq(promoDisclaimers.disclaimerId, disclaimerId))
    .orderBy(desc(promotions.sellStartDate));
}
