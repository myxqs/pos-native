CREATE TABLE "page_asset_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"page_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"provenance" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "page_asset_links" ADD CONSTRAINT "page_asset_links_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_asset_links" ADD CONSTRAINT "page_asset_links_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "page_asset_links_page_asset_unique" ON "page_asset_links" USING btree ("page_id","asset_id");--> statement-breakpoint
CREATE INDEX "page_asset_links_page_created_idx" ON "page_asset_links" USING btree ("page_id","created_at","id");