import { db } from "@/db";
import { sql } from "drizzle-orm";
import type { SearchResults } from "@/types";

/**
 * Global full-text + fuzzy search across promotions, voyages, ships, and
 * disclaimers. Promotions use the generated tsvector column; the rest use
 * pg_trgm-backed ILIKE matching.
 */
export async function globalSearch(q: string, limitPerType = 6): Promise<SearchResults> {
  const term = q.trim();
  if (!term) {
    return { promotions: [], voyages: [], ships: [], disclaimers: [] };
  }
  const like = `%${term}%`;

  const [promoRows, voyageRows, shipRows, disclaimerRows] = await Promise.all([
    db.execute<{ id: string; promo_name: string; promo_code: string | null; status: string }>(sql`
      SELECT id, promo_name, promo_code, status
      FROM promotions
      WHERE search_vector @@ plainto_tsquery('english', ${term})
        OR promo_name ILIKE ${like}
        OR promo_code ILIKE ${like}
      ORDER BY
        ts_rank(search_vector, plainto_tsquery('english', ${term})) DESC,
        sell_start_date DESC
      LIMIT ${limitPerType}
    `),
    db.execute<{ id: string; voyage_code: string; itinerary_name: string; sail_date: string; ship_name: string }>(sql`
      SELECT v.id, v.voyage_code, v.itinerary_name, v.sail_date, s.name AS ship_name
      FROM voyages v JOIN ships s ON v.ship_id = s.id
      WHERE v.voyage_code ILIKE ${like}
        OR v.itinerary_name ILIKE ${like}
        OR s.name ILIKE ${like}
      ORDER BY v.sail_date DESC
      LIMIT ${limitPerType}
    `),
    db.execute<{ id: string; name: string; ship_class: string | null; home_port: string | null }>(sql`
      SELECT id, name, ship_class, home_port
      FROM ships
      WHERE name ILIKE ${like} OR ship_class ILIKE ${like}
      LIMIT ${limitPerType}
    `),
    db.execute<{ id: string; name: string; status: string; version: number }>(sql`
      SELECT id, name, status, version
      FROM disclaimers
      WHERE name ILIKE ${like} OR disclaimer_text ILIKE ${like}
      LIMIT ${limitPerType}
    `),
  ]);

  return {
    promotions: (promoRows as unknown as { id: string; promo_name: string; promo_code: string | null; status: string }[]).map((r) => ({
      id: r.id,
      type: "promotion" as const,
      title: r.promo_name,
      subtitle: [r.promo_code, r.status.replace(/_/g, " ")].filter(Boolean).join(" · "),
      url: `/promotions/${r.id}`,
    })),
    voyages: (voyageRows as unknown as { id: string; voyage_code: string; itinerary_name: string; sail_date: string; ship_name: string }[]).map((r) => ({
      id: r.id,
      type: "voyage" as const,
      title: `${r.voyage_code} — ${r.itinerary_name}`,
      subtitle: `${r.ship_name} · sails ${r.sail_date}`,
      url: `/voyages/${r.id}`,
    })),
    ships: (shipRows as unknown as { id: string; name: string; ship_class: string | null; home_port: string | null }[]).map((r) => ({
      id: r.id,
      type: "ship" as const,
      title: r.name,
      subtitle: [r.ship_class && `${r.ship_class} class`, r.home_port].filter(Boolean).join(" · "),
      url: `/ships?highlight=${r.id}`,
    })),
    disclaimers: (disclaimerRows as unknown as { id: string; name: string; status: string; version: number }[]).map((r) => ({
      id: r.id,
      type: "disclaimer" as const,
      title: r.name,
      subtitle: `v${r.version} · ${r.status}`,
      url: `/disclaimers?highlight=${r.id}`,
    })),
  };
}
