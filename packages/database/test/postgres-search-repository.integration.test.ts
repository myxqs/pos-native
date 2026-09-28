import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";

import { PostgresSearchRepository } from "../src/postgres-search-repository.ts";
import * as schema from "../src/schema.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const liveTest = databaseUrl ? test : test.skip;
let pool: Pool | undefined;
let repository: PostgresSearchRepository | undefined;

beforeAll(async () => {
  if (!databaseUrl) return;
  pool = new Pool({ connectionString: databaseUrl });
  const database = drizzle(pool, { schema });
  await migrate(database, {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  repository = new PostgresSearchRepository(database);
});

beforeEach(async () => {
  await pool?.query("TRUNCATE audit_events, revisions, blocks, pages CASCADE");
});

afterAll(async () => pool?.end());

liveTest("migrates pg_trgm and active search indexes", async () => {
  const extension = await pool!.query(
    "select extname from pg_extension where extname = 'pg_trgm'",
  );
  expect(extension.rows).toEqual([{ extname: "pg_trgm" }]);
  const indexes = await pool!.query(
    "select indexname from pg_indexes where indexname like '%_search_%_idx' order by indexname",
  );
  expect(indexes.rows.map((row) => row.indexname)).toEqual([
    "blocks_search_text_fts_idx",
    "blocks_search_text_trgm_idx",
    "pages_search_title_fts_idx",
    "pages_search_title_trgm_idx",
  ]);
});

liveTest(
  "searches canonical title and paragraph state with deterministic ranking",
  async () => {
    const exact = await seedPage("Alpha", ["other"]);
    const prefix = await seedPage("Alpha notes", ["alpha in body"]);
    const body = await seedPage("Zebra", ["alpha details"]);

    await expect(
      repository!.search({ query: "alpha", limit: 20 }),
    ).resolves.toEqual([
      expect.objectContaining({
        pageId: exact,
        matchSource: "title",
        rank: 500,
      }),
      expect.objectContaining({
        pageId: prefix,
        matchSource: "title",
        rank: 450,
      }),
      expect.objectContaining({
        pageId: body,
        matchSource: "paragraph",
        rank: 250,
      }),
    ]);
  },
);

liveTest(
  "reflects updates, archives, restores, limits, and repository restart",
  async () => {
    const first = await seedPage("First", ["needle one"]);
    const second = await seedPage("Second", ["needle two"]);
    expect(
      await repository!.search({ query: "needle", limit: 1 }),
    ).toHaveLength(1);
    await pool!.query("update pages set archived_at = now() where id = $1", [
      first,
    ]);
    expect(
      (await repository!.search({ query: "needle", limit: 20 })).map(
        (item) => item.pageId,
      ),
    ).toEqual([second]);
    await pool!.query(
      "update pages set archived_at = null, title = 'Needle' where id = $1",
      [first],
    );
    const restarted = new PostgresSearchRepository(drizzle(pool!, { schema }));
    expect(
      (await restarted.search({ query: "needle", limit: 20 }))[0],
    ).toMatchObject({ pageId: first, rank: 500 });
  },
);

liveTest("uses an active trigram index for bounded candidates", async () => {
  await seedPage("Navigation handbook", ["workspace search"]);
  await pool!.query("set enable_seqscan = off");
  const plan = await pool!.query(
    "explain (format text) select id from pages where archived_at is null and lower(title) % lower($1) limit 50",
    ["navigtion"],
  );
  await pool!.query("reset enable_seqscan");
  expect(plan.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain(
    "pages_search_title_trgm_idx",
  );
});

liveTest(
  "collapses repeated paragraph matches before applying the candidate cap",
  async () => {
    const crowded = await seedPage(
      "A crowded page",
      Array.from({ length: 21 }, () => "needle repeated"),
    );
    const other = await seedPage("B other page", ["needle present"]);
    expect(
      (await repository!.search({ query: "needle", limit: 2 })).map(
        (item) => item.pageId,
      ),
    ).toEqual([other, crowded]);
  },
);

async function seedPage(
  title: string,
  paragraphs: readonly string[],
): Promise<string> {
  const pageId = randomUUID();
  await pool!.query(
    `insert into pages (id, title, created_at, updated_at, provenance)
     values ($1, $2, now(), now(), '{"source":"test","actorId":"test"}')`,
    [pageId, title],
  );
  for (const [position, text] of paragraphs.entries()) {
    await pool!.query(
      `insert into blocks (id, page_id, block_type, position, content, created_at, updated_at)
       values ($1, $2, 'paragraph', $3, jsonb_build_object('text', $4::text), now(), now())`,
      [randomUUID(), pageId, position, text],
    );
  }
  return pageId;
}
