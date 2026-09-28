CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "blocks_search_text_trgm_idx" ON "blocks" USING gin (lower(("content"->>'text')) gin_trgm_ops) WHERE "blocks"."archived_at" is null and "blocks"."block_type" = 'paragraph';--> statement-breakpoint
CREATE INDEX "blocks_search_text_fts_idx" ON "blocks" USING gin (to_tsvector('simple', coalesce("content"->>'text', ''))) WHERE "blocks"."archived_at" is null and "blocks"."block_type" = 'paragraph';--> statement-breakpoint
CREATE INDEX "pages_search_title_trgm_idx" ON "pages" USING gin (lower("title") gin_trgm_ops) WHERE "pages"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "pages_search_title_fts_idx" ON "pages" USING gin (to_tsvector('simple', "title")) WHERE "pages"."archived_at" is null;
