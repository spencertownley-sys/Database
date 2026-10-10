CREATE TABLE "availability_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "availability_exceptions_member_date_unique" UNIQUE("member_id","date")
);
--> statement-breakpoint
CREATE TABLE "availability_weekly" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"time_block" text NOT NULL,
	"status" text DEFAULT 'unavailable' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "availability_weekly_member_slot_unique" UNIQUE("member_id","day_of_week","time_block")
);
--> statement-breakpoint
CREATE TABLE "band_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"band_id" uuid NOT NULL,
	"name" text NOT NULL,
	"instrument" text,
	"member_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"last_seen_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "band_members_member_token_unique" UNIQUE("member_token")
);
--> statement-breakpoint
CREATE TABLE "bands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"leader_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "bands_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "profiles_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_member_id_band_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."band_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_weekly" ADD CONSTRAINT "availability_weekly_member_id_band_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."band_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "band_members" ADD CONSTRAINT "band_members_band_id_bands_id_fk" FOREIGN KEY ("band_id") REFERENCES "public"."bands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bands" ADD CONSTRAINT "bands_leader_id_profiles_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_availability_exceptions_member" ON "availability_exceptions" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_availability_weekly_member" ON "availability_weekly" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_band_members_band" ON "band_members" USING btree ("band_id");--> statement-breakpoint
CREATE INDEX "idx_band_members_token" ON "band_members" USING btree ("member_token");--> statement-breakpoint
CREATE INDEX "idx_bands_leader" ON "bands" USING btree ("leader_id");