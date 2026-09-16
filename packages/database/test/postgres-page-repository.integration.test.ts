import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";

import { createPage, updatePage } from "../../domain/src/page.ts";
import { PostgresPageRepository } from "../src/postgres-page-repository.ts";
import * as schema from "../src/schema.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const liveTest = databaseUrl ? test : test.skip;
let pool: Pool | undefined;
let repository: PostgresPageRepository | undefined;

beforeAll(async () => {
  if (!databaseUrl) return;
  pool = new Pool({ connectionString: databaseUrl });
  const database = drizzle(pool, { schema });
  await migrate(database, {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  repository = new PostgresPageRepository(database);
});

beforeEach(async () => {
  if (!pool) return;
  await pool.query("TRUNCATE audit_events, revisions, pages CASCADE");
});

afterAll(async () => {
  await pool?.end();
});

liveTest("persists create and update mutations in PostgreSQL", async () => {
  if (!repository) throw new Error("live repository was not initialised");
  const created = createPage(
    {
      title: "Domain",
      actorType: "user",
      actorId: "integration-user",
      source: "integration-test",
    },
    { newId: randomUUID, now: () => new Date("2026-09-16T10:00:00.000Z") },
  );
  await repository.create(created);
  const updated = updatePage(
    created.page,
    1,
    {
      title: "Projects",
      actorType: "user",
      actorId: "integration-user",
      source: "integration-test",
    },
    { newId: randomUUID, now: () => new Date("2026-09-16T11:00:00.000Z") },
  );

  await repository.update(updated);

  await expect(repository.getById(created.page.id)).resolves.toEqual({
    page: updated.page,
    revisionNumber: 2,
  });
  await expect(repository.list()).resolves.toEqual([updated.page]);
});
