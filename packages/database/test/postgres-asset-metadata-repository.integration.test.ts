import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";

import {
  createAssetMutation,
  prepareAssetCreation,
  type AssetStorageKey,
  type CreateAssetMutation,
} from "../../domain/src/asset.ts";
import { PostgresAssetMetadataRepository } from "../src/postgres-asset-metadata-repository.ts";
import * as schema from "../src/schema.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const liveTest = databaseUrl ? test : test.skip;
let pool: Pool | undefined;
let repository: PostgresAssetMetadataRepository | undefined;
let database: NodePgDatabase<typeof schema> | undefined;

function assetCreation(ids: readonly string[]): CreateAssetMutation {
  const generated = [...ids];
  const prepared = prepareAssetCreation(
    {
      originalFilename: "evidence.pdf",
      mimeType: "application/pdf",
      actorType: "user",
      actorId: "integration-user",
      source: "integration-test",
    },
    {
      newId: () => generated.shift() ?? "",
      now: () => new Date("2026-09-21T13:00:00.000Z"),
    },
  );
  return createAssetMutation(prepared, {
    id: prepared.id,
    originalFilename: prepared.originalFilename,
    mimeType: prepared.mimeType,
    storageKey: `asset-${prepared.id}` as AssetStorageKey,
    byteSize: 12,
    sha256: "a".repeat(64),
  });
}

beforeAll(async () => {
  if (!databaseUrl) return;
  pool = new Pool({ connectionString: databaseUrl });
  database = drizzle(pool, { schema });
  await migrate(database, {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  repository = new PostgresAssetMetadataRepository(database);
});

beforeEach(async () => {
  if (!pool) return;
  await pool.query("TRUNCATE audit_events, revisions, assets CASCADE");
});

afterAll(async () => {
  await pool?.end();
});

liveTest("persists an asset metadata mutation in PostgreSQL", async () => {
  if (!repository) throw new Error("live repository was not initialised");
  const mutation = assetCreation([randomUUID(), randomUUID(), randomUUID()]);

  await repository.create(mutation);

  await expect(repository.getById(mutation.asset.id)).resolves.toEqual({
    asset: mutation.asset,
    revisionNumber: 1,
  });
  await expect(repository.list()).resolves.toEqual([mutation.asset]);
});

liveTest(
  "rolls back a new asset row when its later revision insert conflicts",
  async () => {
    if (!repository || !database) {
      throw new Error("live repository was not initialised");
    }
    const duplicateRevisionId = randomUUID();
    const first = assetCreation([
      randomUUID(),
      duplicateRevisionId,
      randomUUID(),
    ]);
    const second = assetCreation([
      randomUUID(),
      duplicateRevisionId,
      randomUUID(),
    ]);
    await repository.create(first);

    await expect(repository.create(second)).rejects.toThrow();
    await expect(repository.getById(second.asset.id)).resolves.toBeNull();
    await expect(
      database.select().from(schema.revisions),
    ).resolves.toHaveLength(1);
    await expect(
      database.select().from(schema.auditEvents),
    ).resolves.toHaveLength(1);
  },
);
