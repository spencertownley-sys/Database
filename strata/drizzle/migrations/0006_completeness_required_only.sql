ALTER TABLE "fields" RENAME COLUMN "required" TO "required_for_completeness";--> statement-breakpoint
ALTER TABLE "fields" DROP COLUMN "counts_toward_completeness";