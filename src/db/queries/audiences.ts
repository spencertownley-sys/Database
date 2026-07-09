import { db } from "@/db";
import { audienceSegments } from "@/db/schema";
import { asc, sql } from "drizzle-orm";

export async function listAudienceSegmentsWithUsage() {
  return db
    .select({
      segment: audienceSegments,
      activePromoCount: sql<number>`(
        SELECT count(*)::int FROM promo_audiences pa
        JOIN promotions p ON pa.promo_id = p.id
        WHERE pa.segment_id = audience_segments.id
        AND p.status IN ('approved', 'live', 'paused')
      )`,
      totalPromoCount: sql<number>`(
        SELECT count(*)::int FROM promo_audiences pa
        WHERE pa.segment_id = audience_segments.id
      )`,
    })
    .from(audienceSegments)
    .orderBy(asc(audienceSegments.name));
}
