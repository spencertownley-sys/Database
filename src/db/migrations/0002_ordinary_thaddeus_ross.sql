ALTER TABLE "availability_exceptions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "availability_weekly" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "availability_exceptions" CASCADE;--> statement-breakpoint
DROP TABLE "availability_weekly" CASCADE;--> statement-breakpoint
UPDATE "bands" SET "start_date" = CURRENT_DATE WHERE "start_date" IS NULL;--> statement-breakpoint
UPDATE "bands" SET "end_date" = CURRENT_DATE + INTERVAL '27 days' WHERE "end_date" IS NULL;--> statement-breakpoint
ALTER TABLE "bands" ALTER COLUMN "start_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bands" ALTER COLUMN "end_date" SET NOT NULL;