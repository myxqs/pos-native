ALTER TABLE "pages" ADD COLUMN "current_revision_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "pages"
SET "current_revision_number" = COALESCE(
  (
    SELECT MAX("revision_number")
    FROM "revisions"
    WHERE "entity_type" = 'page'
      AND "entity_id" = "pages"."id"
  ),
  0
);
