-- Full-text search: generated tsvector column on promotions + GIN index.
-- pg_trgm enables fuzzy matching for global search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
-- array_to_string() is only STABLE; generated columns need IMMUTABLE inputs.
CREATE OR REPLACE FUNCTION immutable_array_to_string(text[], text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS 'SELECT array_to_string($1, $2)';
--> statement-breakpoint
ALTER TABLE promotions ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(promo_name, '') || ' ' ||
      coalesce(promo_code, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      coalesce(headline, '') || ' ' ||
      coalesce(notes, '') || ' ' ||
      coalesce(immutable_array_to_string(tags, ' '), '')
    )
  ) STORED;
--> statement-breakpoint
CREATE INDEX idx_promotions_search ON promotions USING gin(search_vector);
--> statement-breakpoint
CREATE INDEX idx_promotions_name_trgm ON promotions USING gin(promo_name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX idx_voyages_code_trgm ON voyages USING gin(voyage_code gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX idx_voyages_itinerary_trgm ON voyages USING gin(itinerary_name gin_trgm_ops);
