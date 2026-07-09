CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" uuid,
	"performed_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "audience_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"criteria" jsonb DEFAULT '{}'::jsonb,
	"estimated_size" integer,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "audience_segments_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "disclaimers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"disclaimer_text" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"applies_to_offer_types" text[],
	"legal_approved_by" text,
	"legal_approved_at" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_date" date,
	"expiry_date" date,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"department" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "profiles_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "promo_audiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promo_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	CONSTRAINT "promo_audiences_promo_id_segment_id_unique" UNIQUE("promo_id","segment_id")
);
--> statement-breakpoint
CREATE TABLE "promo_disclaimers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promo_id" uuid NOT NULL,
	"disclaimer_id" uuid NOT NULL,
	CONSTRAINT "promo_disclaimers_promo_id_disclaimer_id_unique" UNIQUE("promo_id","disclaimer_id")
);
--> statement-breakpoint
CREATE TABLE "promo_performance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promo_id" uuid NOT NULL,
	"voyage_id" uuid,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"bookings" integer DEFAULT 0,
	"revenue" numeric(12, 2) DEFAULT '0',
	"redemptions" integer DEFAULT 0,
	"cancellations" integer DEFAULT 0,
	"avg_booking_value" numeric(10, 2),
	"incremental_bookings" integer,
	"recorded_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "promo_voyages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promo_id" uuid NOT NULL,
	"voyage_id" uuid NOT NULL,
	"override_offer_value" text,
	"override_details" jsonb,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "promo_voyages_promo_id_voyage_id_unique" UNIQUE("promo_id","voyage_id")
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promo_name" text NOT NULL,
	"promo_code" text,
	"description" text,
	"offer_type" text NOT NULL,
	"offer_value" text NOT NULL,
	"offer_details" jsonb DEFAULT '{}'::jsonb,
	"sell_start_date" date NOT NULL,
	"sell_end_date" date NOT NULL,
	"sail_start_date" date,
	"sail_end_date" date,
	"market" text[],
	"booking_channels" text[],
	"is_combinable" boolean DEFAULT false,
	"status" text DEFAULT 'draft' NOT NULL,
	"owner_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"source" text,
	"priority" text DEFAULT 'normal',
	"notes" text,
	"tags" text[],
	"headline" text,
	"terms_summary" text,
	"content" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "promotions_promo_code_unique" UNIQUE("promo_code")
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "regions_name_unique" UNIQUE("name"),
	CONSTRAINT "regions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "ships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"brand" text NOT NULL,
	"ship_class" text,
	"capacity_guests" integer NOT NULL,
	"year_built" integer,
	"home_port" text,
	"status" text DEFAULT 'active' NOT NULL,
	"image_url" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "ships_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "voyages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voyage_code" text NOT NULL,
	"ship_id" uuid NOT NULL,
	"region_id" uuid,
	"itinerary_name" text NOT NULL,
	"sail_date" date NOT NULL,
	"return_date" date NOT NULL,
	"duration_nights" integer NOT NULL,
	"embark_port" text NOT NULL,
	"debark_port" text NOT NULL,
	"ports_of_call" text[],
	"status" text DEFAULT 'open' NOT NULL,
	"cabin_categories" jsonb DEFAULT '[]'::jsonb,
	"occupancy_percent" numeric(5, 2),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "voyages_voyage_code_unique" UNIQUE("voyage_code")
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_performed_by_profiles_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_audiences" ADD CONSTRAINT "promo_audiences_promo_id_promotions_id_fk" FOREIGN KEY ("promo_id") REFERENCES "public"."promotions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_audiences" ADD CONSTRAINT "promo_audiences_segment_id_audience_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."audience_segments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_disclaimers" ADD CONSTRAINT "promo_disclaimers_promo_id_promotions_id_fk" FOREIGN KEY ("promo_id") REFERENCES "public"."promotions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_disclaimers" ADD CONSTRAINT "promo_disclaimers_disclaimer_id_disclaimers_id_fk" FOREIGN KEY ("disclaimer_id") REFERENCES "public"."disclaimers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_performance" ADD CONSTRAINT "promo_performance_promo_id_promotions_id_fk" FOREIGN KEY ("promo_id") REFERENCES "public"."promotions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_performance" ADD CONSTRAINT "promo_performance_voyage_id_voyages_id_fk" FOREIGN KEY ("voyage_id") REFERENCES "public"."voyages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_voyages" ADD CONSTRAINT "promo_voyages_promo_id_promotions_id_fk" FOREIGN KEY ("promo_id") REFERENCES "public"."promotions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_voyages" ADD CONSTRAINT "promo_voyages_voyage_id_voyages_id_fk" FOREIGN KEY ("voyage_id") REFERENCES "public"."voyages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_voyages" ADD CONSTRAINT "promo_voyages_added_by_profiles_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_approved_by_profiles_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voyages" ADD CONSTRAINT "voyages_ship_id_ships_id_fk" FOREIGN KEY ("ship_id") REFERENCES "public"."ships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voyages" ADD CONSTRAINT "voyages_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_activity_entity" ON "activity_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_activity_time" ON "activity_log" USING btree ("performed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_perf_promo" ON "promo_performance" USING btree ("promo_id");--> statement-breakpoint
CREATE INDEX "idx_perf_voyage" ON "promo_performance" USING btree ("voyage_id");--> statement-breakpoint
CREATE INDEX "idx_pv_promo" ON "promo_voyages" USING btree ("promo_id");--> statement-breakpoint
CREATE INDEX "idx_pv_voyage" ON "promo_voyages" USING btree ("voyage_id");--> statement-breakpoint
CREATE INDEX "idx_promotions_status" ON "promotions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_promotions_sell_dates" ON "promotions" USING btree ("sell_start_date","sell_end_date");--> statement-breakpoint
CREATE INDEX "idx_promotions_promo_code" ON "promotions" USING btree ("promo_code");--> statement-breakpoint
CREATE INDEX "idx_promotions_owner" ON "promotions" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "idx_voyages_sail_date" ON "voyages" USING btree ("sail_date");--> statement-breakpoint
CREATE INDEX "idx_voyages_ship_id" ON "voyages" USING btree ("ship_id");--> statement-breakpoint
CREATE INDEX "idx_voyages_region_id" ON "voyages" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "idx_voyages_status" ON "voyages" USING btree ("status");