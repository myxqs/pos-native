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
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "pages"
    WHERE "current_revision_number" = 0
  ) THEN
    RAISE EXCEPTION 'NativePOS pages without revision history require repair before migration';
  END IF;
END $$;
