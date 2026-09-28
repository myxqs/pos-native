ALTER TABLE "property_definitions" ADD COLUMN "name_key" text;--> statement-breakpoint
UPDATE "property_definitions" SET "name_key" = translate(normalize("name", NFKC), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');--> statement-breakpoint
ALTER TABLE "property_definitions" ALTER COLUMN "name_key" SET NOT NULL;--> statement-breakpoint
DROP INDEX "property_definitions_source_name_ci_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "property_definitions_source_name_key_unique" ON "property_definitions" USING btree ("source_id","name_key");--> statement-breakpoint
ALTER TABLE "data_source_items" ADD CONSTRAINT "data_source_items_property_revision_positive" CHECK ("current_property_revision_number" >= 1);--> statement-breakpoint
ALTER TABLE "property_definitions" ADD CONSTRAINT "property_definitions_kind_supported" CHECK ("kind" in ('text', 'number', 'checkbox', 'select', 'multi-select', 'status', 'date', 'datetime', 'url', 'email', 'phone', 'relation'));--> statement-breakpoint
ALTER TABLE "property_definitions" ADD CONSTRAINT "property_definitions_shape_valid" CHECK (("kind" = 'relation' and "target_source_id" is not null and "options" is null) or ("kind" in ('select', 'multi-select', 'status') and "target_source_id" is null and "options" is not null) or ("kind" in ('text', 'number', 'checkbox', 'date', 'datetime', 'url', 'email', 'phone') and "target_source_id" is null and "options" is null));
