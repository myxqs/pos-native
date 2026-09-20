ALTER TABLE "users" ADD COLUMN "owner_slot" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_owner_slot_unique" UNIQUE("owner_slot");