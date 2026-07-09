import { db } from "@/db";
import { sql } from "drizzle-orm";

export type CalendarPromo = {
  id: string;
  promo_name: string;
  status: string;
  offer_type: string;
  sell_start_date: string;
  sell_end_date: string;
  region_name: string | null;
  ship_name: string | null;
};

/**
 * Promotions overlapping [from, to] with their dominant region and ship
 * (the region/ship carrying the most linked voyages), for the timeline lanes.
 */
export async function calendarPromos(
  from: string,
  to: string
): Promise<CalendarPromo[]> {
  const rows = await db.execute<CalendarPromo>(sql`
    SELECT p.id, p.promo_name, p.status, p.offer_type,
      p.sell_start_date, p.sell_end_date,
      dominant.region_name, dominant.ship_name
    FROM promotions p
    LEFT JOIN LATERAL (
      SELECT r.name AS region_name, s.name AS ship_name
      FROM promo_voyages pv
      JOIN voyages v ON pv.voyage_id = v.id
      JOIN ships s ON v.ship_id = s.id
      LEFT JOIN regions r ON v.region_id = r.id
      WHERE pv.promo_id = p.id
      GROUP BY r.name, s.name
      ORDER BY count(*) DESC
      LIMIT 1
    ) dominant ON true
    WHERE p.sell_start_date <= ${to} AND p.sell_end_date >= ${from}
    ORDER BY p.sell_start_date
    LIMIT 400
  `);
  return rows as unknown as CalendarPromo[];
}
