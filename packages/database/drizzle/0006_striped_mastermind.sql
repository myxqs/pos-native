CREATE TABLE "data_source_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_id" uuid NOT NULL,
	"current_property_revision_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"options" jsonb,
	"target_source_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_values" (
	"record_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"value" jsonb NOT NULL,
	CONSTRAINT "property_values_record_id_definition_id_pk" PRIMARY KEY("record_id","definition_id")
);
--> statement-breakpoint
CREATE TABLE "relation_edges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_record_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"target_record_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "data_source_items" ADD CONSTRAINT "data_source_items_id_pages_id_fk" FOREIGN KEY ("id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_source_items" ADD CONSTRAINT "data_source_items_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_definitions" ADD CONSTRAINT "property_definitions_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_definitions" ADD CONSTRAINT "property_definitions_target_source_id_data_sources_id_fk" FOREIGN KEY ("target_source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_values" ADD CONSTRAINT "property_values_record_id_data_source_items_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."data_source_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_values" ADD CONSTRAINT "property_values_definition_id_property_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."property_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_edges" ADD CONSTRAINT "relation_edges_source_record_id_data_source_items_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."data_source_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_edges" ADD CONSTRAINT "relation_edges_definition_id_property_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."property_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_edges" ADD CONSTRAINT "relation_edges_target_record_id_data_source_items_id_fk" FOREIGN KEY ("target_record_id") REFERENCES "public"."data_source_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_source_items_source_id_idx" ON "data_source_items" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "property_definitions_source_name_ci_unique" ON "property_definitions" USING btree ("source_id",lower("name"));--> statement-breakpoint
CREATE INDEX "relation_edges_target_record_id_idx" ON "relation_edges" USING btree ("target_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "relation_edges_live_unique" ON "relation_edges" USING btree ("source_record_id","definition_id","target_record_id") WHERE "archived_at" is null;