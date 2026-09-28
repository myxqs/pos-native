DROP INDEX "page_asset_links_page_asset_unique";--> statement-breakpoint
ALTER TABLE "page_asset_links" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "page_asset_links_live_unique" ON "page_asset_links" USING btree ("page_id","asset_id") WHERE "archived_at" is null;