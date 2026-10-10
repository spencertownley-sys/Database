ALTER TABLE "bands" ADD COLUMN "active_days" integer[] DEFAULT '{0,1,2,3,4,5,6}' NOT NULL;--> statement-breakpoint
ALTER TABLE "bands" ADD COLUMN "use_time_blocks" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bands" ADD COLUMN "active_time_blocks" text[] DEFAULT '{morning,afternoon,evening,night}' NOT NULL;--> statement-breakpoint
ALTER TABLE "bands" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "bands" ADD COLUMN "end_date" date;