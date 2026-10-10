CREATE TABLE "availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"date" date NOT NULL,
	"time_slot" text NOT NULL,
	"status" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "availability_member_date_slot_unique" UNIQUE("member_id","date","time_slot")
);
--> statement-breakpoint
CREATE TABLE "band_day_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"band_id" uuid NOT NULL,
	"date" date NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "band_day_labels_band_date_unique" UNIQUE("band_id","date")
);
--> statement-breakpoint
ALTER TABLE "availability_exceptions" DROP CONSTRAINT "availability_exceptions_member_date_unique";--> statement-breakpoint
ALTER TABLE "availability_weekly" DROP CONSTRAINT "availability_weekly_member_slot_unique";--> statement-breakpoint
ALTER TABLE "availability_exceptions" DROP CONSTRAINT "availability_exceptions_member_id_band_members_id_fk";
--> statement-breakpoint
ALTER TABLE "availability_weekly" DROP CONSTRAINT "availability_weekly_member_id_band_members_id_fk";
--> statement-breakpoint
DROP INDEX "idx_availability_exceptions_member";--> statement-breakpoint
DROP INDEX "idx_availability_weekly_member";--> statement-breakpoint
ALTER TABLE "availability_exceptions" ALTER COLUMN "created_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "availability_weekly" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "availability_weekly" ALTER COLUMN "updated_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "bands" ALTER COLUMN "active_days" SET DEFAULT '{0,1,2,3,4,5,6}'::int[];--> statement-breakpoint
ALTER TABLE "bands" ALTER COLUMN "use_time_blocks" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "bands" ALTER COLUMN "use_time_blocks" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bands" ALTER COLUMN "active_time_blocks" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "bands" ALTER COLUMN "active_time_blocks" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "band_members" ADD COLUMN "profile_id" uuid;--> statement-breakpoint
ALTER TABLE "bands" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "bands" ADD COLUMN "schedule_type" text DEFAULT 'date_time' NOT NULL;--> statement-breakpoint
ALTER TABLE "bands" ADD COLUMN "time_slot_start" text DEFAULT '17:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "bands" ADD COLUMN "time_slot_end" text DEFAULT '22:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "bands" ADD COLUMN "time_slot_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "bands" ADD COLUMN "event_duration_minutes" integer DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE "bands" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "bands" ADD COLUMN "location_type" text DEFAULT 'tbd' NOT NULL;--> statement-breakpoint
ALTER TABLE "bands" ADD COLUMN "timezone" text DEFAULT 'America/New_York' NOT NULL;--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_member_id_band_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."band_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "band_day_labels" ADD CONSTRAINT "band_day_labels_band_id_bands_id_fk" FOREIGN KEY ("band_id") REFERENCES "public"."bands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_availability_member" ON "availability" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_band_day_labels_band" ON "band_day_labels" USING btree ("band_id");--> statement-breakpoint
ALTER TABLE "band_members" ADD CONSTRAINT "band_members_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_band_members_profile" ON "band_members" USING btree ("profile_id");