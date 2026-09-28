CREATE TABLE "page_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_page_id" uuid NOT NULL,
	"target_page_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone,
	"provenance" jsonb NOT NULL,
	CONSTRAINT "page_links_not_self" CHECK ("page_links"."source_page_id" <> "page_links"."target_page_id")
);
--> statement-breakpoint
ALTER TABLE "page_links" ADD CONSTRAINT "page_links_source_page_id_pages_id_fk" FOREIGN KEY ("source_page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_links" ADD CONSTRAINT "page_links_target_page_id_pages_id_fk" FOREIGN KEY ("target_page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "page_links_live_unique" ON "page_links" USING btree ("source_page_id","target_page_id") WHERE "archived_at" is null;--> statement-breakpoint
CREATE INDEX "page_links_source_created_idx" ON "page_links" USING btree ("source_page_id","created_at","id");--> statement-breakpoint
CREATE INDEX "page_links_target_created_idx" ON "page_links" USING btree ("target_page_id","created_at","id");