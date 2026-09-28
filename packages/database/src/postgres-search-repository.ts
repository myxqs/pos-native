import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  boundSearchSnippet,
  type SearchQuery,
  type SearchRepository,
  type SearchResult,
  validateSearchQuery,
} from "./search-repository.ts";
import type * as schema from "./schema.ts";

type Database = NodePgDatabase<typeof schema>;

interface SearchRow extends Record<string, unknown> {
  readonly pageId: string;
  readonly pageTitle: string;
  readonly snippet: string;
  readonly matchSource: "title" | "paragraph";
  readonly rank: number;
}

export class PostgresSearchRepository implements SearchRepository {
  constructor(private readonly database: Database) {}

  async search(input: SearchQuery): Promise<readonly SearchResult[]> {
    const { query, limit } = validateSearchQuery(input);
    const prefix = escapeLike(query.toLocaleLowerCase()) + "%";
    const candidateLimit = limit * 10;
    const result = await this.database.execute<SearchRow>(sql`
      with input as (
        select
          lower(${query})::text as query,
          plainto_tsquery('simple', ${query}) as tsquery
      ), title_candidates as (
        select
          p.id as "pageId",
          p.title as "pageTitle",
          left(p.title, 240) as snippet,
          'title'::text as "matchSource",
          case
            when lower(p.title) = input.query then 500
            when lower(p.title) like ${prefix} escape '\\' then 450
            when to_tsvector('simple', p.title) @@ input.tsquery then 400
            else 350
          end as rank,
          greatest(
            ts_rank_cd(to_tsvector('simple', p.title), input.tsquery),
            similarity(lower(p.title), input.query)
          )::double precision as score,
          -1 as position,
          ''::text as "blockId"
        from pages p cross join input
        where p.archived_at is null
          and (
            lower(p.title) like ${prefix} escape '\\'
            or to_tsvector('simple', p.title) @@ input.tsquery
            or lower(p.title) % input.query
          )
        order by rank desc, score desc, p.title, p.id
        limit ${candidateLimit}
      ), paragraph_matches as (
        select
          p.id as "pageId",
          p.title as "pageTitle",
          left(b.content->>'text', 240) as snippet,
          'paragraph'::text as "matchSource",
          case
            when to_tsvector('simple', coalesce(b.content->>'text', '')) @@ input.tsquery then 250
            else 200
          end as rank,
          greatest(
            ts_rank_cd(to_tsvector('simple', coalesce(b.content->>'text', '')), input.tsquery),
            similarity(lower(b.content->>'text'), input.query)
          )::double precision as score,
          b.position,
          b.id::text as "blockId"
        from blocks b join pages p on p.id = b.page_id cross join input
        where p.archived_at is null
          and b.archived_at is null
          and b.block_type = 'paragraph'
          and (
            to_tsvector('simple', coalesce(b.content->>'text', '')) @@ input.tsquery
            or lower(b.content->>'text') % input.query
          )
      ), paragraph_best_per_page as (
        select distinct on ("pageId") *
        from paragraph_matches
        order by "pageId", rank desc, score desc, position, "blockId"
      ), paragraph_candidates as (
        select * from paragraph_best_per_page
        order by rank desc, score desc, "pageTitle", "pageId", position, "blockId"
        limit ${candidateLimit}
      ), best_per_page as (
        select distinct on ("pageId") *
        from (
          select * from title_candidates
          union all
          select * from paragraph_candidates
        ) candidates
        order by "pageId", rank desc, score desc, position, "blockId"
      )
      select "pageId", "pageTitle", snippet, "matchSource", rank
      from best_per_page
      order by rank desc, score desc, "pageTitle", "pageId"
      limit ${limit}
    `);

    return result.rows.map((row) => ({
      pageId: row.pageId,
      pageTitle: row.pageTitle,
      snippet: boundSearchSnippet(row.snippet),
      matchSource: row.matchSource,
      rank: row.rank,
    }));
  }
}

function escapeLike(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}
