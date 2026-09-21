ALTER TABLE "blocks" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "current_block_document_revision_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Drizzle emitted the composite FK before its required unique target. Keep this
-- reviewed order: PostgreSQL requires the target unique constraint first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "blocks"
    WHERE "position" < 0
  ) THEN
    RAISE EXCEPTION 'NativePOS block migration requires repair: negative block position found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "blocks" AS "child"
    INNER JOIN "blocks" AS "parent"
      ON "parent"."id" = "child"."parent_block_id"
    WHERE "child"."parent_block_id" IS NOT NULL
      AND "child"."page_id" <> "parent"."page_id"
  ) THEN
    RAISE EXCEPTION 'NativePOS block migration requires repair: cross-page block parent found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "blocks"
    GROUP BY
      "page_id",
      COALESCE(
        "parent_block_id",
        '00000000-0000-0000-0000-000000000000'::uuid
      ),
      "position"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'NativePOS block migration requires repair: duplicate live sibling position found';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_id_page_unique" UNIQUE("id","page_id");--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_parent_block_page_fk" FOREIGN KEY ("parent_block_id","page_id") REFERENCES "public"."blocks"("id","page_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "blocks_live_sibling_position_unique" ON "blocks" USING btree ("page_id",coalesce("parent_block_id", '00000000-0000-0000-0000-000000000000'::uuid),"position") WHERE "archived_at" is null;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_position_nonnegative" CHECK ("position" >= 0);
