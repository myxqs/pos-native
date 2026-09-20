ALTER TABLE "sessions" ADD COLUMN "csrf_token_hash" text;--> statement-breakpoint
UPDATE "sessions" SET "revoked_at" = COALESCE("revoked_at", CURRENT_TIMESTAMP), "csrf_token_hash" = 'invalidated-by-csrf-migration' WHERE "csrf_token_hash" IS NULL;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "csrf_token_hash" SET NOT NULL;
