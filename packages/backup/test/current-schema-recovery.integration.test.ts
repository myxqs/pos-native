import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { expect, test } from "vitest";
import { buildApp } from "../../../apps/api/src/app.ts";
import { FilesystemAssetStore } from "../../assets/src/filesystem-asset-store.ts";
import { archivePageLink, createPageLink } from "../../domain/src/page-link.ts";
import { asNativeId } from "../../domain/src/ids.ts";
import { PostgresPageLinkRepository } from "../../database/src/postgres-page-link-repository.ts";
import { PostgresSearchRepository } from "../../database/src/postgres-search-repository.ts";
import * as schema from "../../database/src/schema.ts";
import { FilesystemAssetRestoreTarget } from "../src/asset-restore-target.ts";
import { DockerPostgresBackupDriver } from "../src/docker-postgres-driver.ts";
import {
  createPostgresApplicationBackup,
  restorePostgresApplicationBackup,
} from "../src/postgres-recovery.ts";
import { runRecoveryCommand } from "../src/recovery-command-runner.ts";

const sourceUrl = process.env.RECOVERY_SOURCE_DATABASE_URL;
const targetUrl = process.env.RECOVERY_TARGET_DATABASE_URL;
const container = process.env.RECOVERY_POSTGRES_CONTAINER;
const enabled = Boolean(sourceUrl && targetUrl && container);
const tables = [
  "api_tokens",
  "assets",
  "audit_events",
  "blocks",
  "data_source_items",
  "data_sources",
  "external_identities",
  "idempotency_records",
  "page_asset_links",
  "page_links",
  "pages",
  "property_definitions",
  "property_values",
  "relation_edges",
  "revisions",
  "sessions",
  "users",
] as const;

test.skipIf(!enabled)(
  "restores all 17 current tables with page-link history and derived search",
  async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pos-native-recovery-17-"));
    const backupRoot = join(workspace, "backups");
    const sourceAssets = join(workspace, "source-assets");
    const targetAssets = join(workspace, "target-assets");
    await Promise.all([
      mkdir(backupRoot),
      mkdir(sourceAssets),
      mkdir(targetAssets),
    ]);
    let sourcePool = new Pool({ connectionString: sourceUrl });
    let targetPool = new Pool({ connectionString: targetUrl });
    try {
      const sourceDb = drizzle(sourcePool, { schema });
      await migrate(sourceDb, {
        migrationsFolder: fileURLToPath(
          new URL("../../database/drizzle", import.meta.url),
        ),
      });
      await seed(sourcePool, sourceDb);
      await resetRestoreTarget(targetPool);
      const before = await evidence(sourcePool, sourceDb);
      const sourceDriver = new DockerPostgresBackupDriver(
        {
          container: container!,
          database: "pos_native_source",
          user: "pos_native",
          maxDumpBytes: 16 * 1024 * 1024,
        },
        { run: runRecoveryCommand },
      );
      const backup = await createPostgresApplicationBackup(
        backupRoot,
        sourceDriver,
        await FilesystemAssetStore.create(sourceAssets, {
          maxBytes: 1024 * 1024,
        }),
        {
          schemaVersion: "0011",
          applicationVersion: "0.1.0",
          databaseDumpFormat: "postgresql-custom-v1",
          assetStoreFormat: "filesystem-v1",
        },
        {
          backupId: asNativeId("cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
          createdAt: new Date("2026-09-28T18:00:00.000Z"),
          maxArtifactBytes: 16 * 1024 * 1024,
        },
      );
      const targetDriver = new DockerPostgresBackupDriver(
        {
          container: container!,
          database: "pos_native_target",
          user: "pos_native",
          maxDumpBytes: 16 * 1024 * 1024,
        },
        { run: runRecoveryCommand },
      );
      await restorePostgresApplicationBackup(
        backupRoot,
        backup.backupId,
        targetDriver,
        await FilesystemAssetRestoreTarget.create(targetAssets, 1024 * 1024),
        { maxArtifactBytes: 16 * 1024 * 1024 },
      );
      const targetDb = drizzle(targetPool, { schema });
      const after = await evidence(targetPool, targetDb);
      expect(after).toEqual(before);
      expect(Object.keys(after.tables)).toEqual(tables);
      expect(after.forward).toHaveLength(1);
      expect(after.backlinks).toHaveLength(1);
      expect(after.history).toHaveLength(2);
      expect(after.history[0]?.link.archivedAt).not.toBeNull();
      expect(after.history[0]?.link.id).not.toBe(after.history[1]?.link.id);
      expect(after.revisions.map((row) => row.revision_number)).toEqual([
        1, 2, 1,
      ]);
      expect(after.audits.map((row) => row.action)).toEqual([
        "page.linked",
        "page.unlinked",
        "page.linked",
      ]);
      expect(after.search.statusCode).toBe(200);
      expect(after.search.body.results[0]).toMatchObject({
        pageTitle: "Alpha Workspace",
        snippet: "recovery searchable paragraph",
      });

      await Promise.all([sourcePool.end(), targetPool.end()]);
      await restartPostgres(container!);
      sourcePool = new Pool({ connectionString: sourceUrl });
      targetPool = new Pool({ connectionString: targetUrl });
      const restartedTargetDb = drizzle(targetPool, { schema });
      expect(await evidence(targetPool, restartedTargetDb)).toEqual(before);
    } finally {
      await Promise.allSettled([sourcePool.end(), targetPool.end()]);
      await rm(workspace, { force: true, recursive: true });
    }
  },
);

async function restartPostgres(containerName: string) {
  await runRecoveryCommand({
    executable: "docker",
    arguments: ["restart", containerName],
    maxOutputBytes: 1024,
  });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await runRecoveryCommand({
        executable: "docker",
        arguments: [
          "exec",
          containerName,
          "pg_isready",
          "-h",
          "127.0.0.1",
          "-U",
          "pos_native",
          "-d",
          "pos_native_target",
        ],
        maxOutputBytes: 1024,
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("restarted PostgreSQL container did not become ready");
}

async function resetRestoreTarget(pool: Pool) {
  await pool.query("drop schema if exists drizzle cascade");
  await pool.query("drop schema public cascade");
  await pool.query("create schema public");
}

async function seed(
  pool: Pool,
  database: ReturnType<typeof drizzle<typeof schema>>,
) {
  await pool.query(`truncate ${tables.join(",")} restart identity cascade`);
  const source = asNativeId("11111111-1111-4111-8111-111111111111");
  const target = asNativeId("22222222-2222-4222-8222-222222222222");
  await database.insert(schema.pages).values([
    {
      id: source,
      title: "Alpha Workspace",
      createdAt: new Date("2026-09-28T12:00:00Z"),
      updatedAt: new Date("2026-09-28T12:00:00Z"),
      provenance: { source: "recovery-test", actorId: "owner" },
    },
    {
      id: target,
      title: "Linked Target",
      createdAt: new Date("2026-09-28T12:00:00Z"),
      updatedAt: new Date("2026-09-28T12:00:00Z"),
      provenance: { source: "recovery-test", actorId: "owner" },
    },
  ]);
  await database.insert(schema.blocks).values({
    id: "33333333-3333-4333-8333-333333333333",
    pageId: source,
    blockType: "paragraph",
    position: 0,
    content: { text: "recovery searchable paragraph" },
    createdAt: new Date("2026-09-28T12:01:00Z"),
    updatedAt: new Date("2026-09-28T12:01:00Z"),
  });
  const ids = [
    "44444444-4444-4444-8444-444444444444",
    "55555555-5555-4555-8555-555555555555",
    "66666666-6666-4666-8666-666666666666",
    "77777777-7777-4777-8777-777777777777",
    "88888888-8888-4888-8888-888888888888",
    "99999999-9999-4999-8999-999999999999",
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  ];
  const nextId = () => ids.shift() ?? randomUUID();
  const repository = new PostgresPageLinkRepository(database);
  const original = createPageLink(
    {
      sourcePageId: source,
      targetPageId: target,
      actorType: "user",
      actorId: "owner",
      source: "recovery-test",
    },
    { newId: nextId, now: () => new Date("2026-09-28T13:00:00Z") },
  );
  await repository.create(original);
  await repository.archive(
    archivePageLink(
      original.link,
      1,
      { actorType: "user", actorId: "owner", source: "recovery-test" },
      { newId: nextId, now: () => new Date("2026-09-28T14:00:00Z") },
    ),
  );
  await repository.create(
    createPageLink(
      {
        sourcePageId: source,
        targetPageId: target,
        actorType: "user",
        actorId: "owner",
        source: "recovery-test",
      },
      { newId: nextId, now: () => new Date("2026-09-28T15:00:00Z") },
    ),
  );
}

async function evidence(
  pool: Pool,
  database: ReturnType<typeof drizzle<typeof schema>>,
) {
  const tableEvidence: Record<string, { count: number; hash: string }> = {};
  for (const table of tables) {
    const result = await pool.query<{ count: string; hash: string }>(
      `select count(*)::text count, md5(coalesce(string_agg(to_jsonb(t)::text, '' order by to_jsonb(t)::text), '')) hash from ${table} t`,
    );
    tableEvidence[table] = {
      count: Number(result.rows[0]!.count),
      hash: result.rows[0]!.hash,
    };
  }
  const root = asNativeId("11111111-1111-4111-8111-111111111111");
  const target = asNativeId("22222222-2222-4222-8222-222222222222");
  const links = new PostgresPageLinkRepository(database);
  const searchApp = buildApp({
    searchRepository: new PostgresSearchRepository(database),
    authorize: async () => ({
      ok: true,
      actor: { actorType: "user", actorId: "owner", source: "recovery-test" },
    }),
  });
  const response = await searchApp.inject({
    method: "GET",
    url: "/api/v1/search?q=recovery%20searchable&limit=5",
  });
  await searchApp.close();
  return {
    tables: tableEvidence,
    forward: await links.listForward(root, { scope: "active", limit: 20 }),
    backlinks: await links.listBacklinks(target, {
      scope: "active",
      limit: 20,
    }),
    history: await links.listForward(root, { scope: "all", limit: 20 }),
    revisions: (
      await pool.query(
        "select entity_id,revision_number,snapshot from revisions where entity_type='page-link' order by created_at,revision_number,id",
      )
    ).rows,
    audits: (
      await pool.query(
        "select target_id,action,before,after from audit_events where target_type='page-link' order by occurred_at,id",
      )
    ).rows,
    search: { statusCode: response.statusCode, body: response.json() },
  };
}
