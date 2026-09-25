import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";

import { asNativeId, ValidationError } from "../../domain/src/ids.ts";
import type { AssetStore } from "../../assets/src/asset-storage.ts";
import { asAssetStorageKey } from "../../domain/src/asset.ts";
import {
  sha256ForBytes,
  type BackupSourceAsset,
} from "../src/backup-manifest.ts";
import type { BackupOperationOptions } from "../src/filesystem-backup.ts";
import {
  createPostgresDatabaseBackup,
  createPostgresApplicationBackup,
  restorePostgresDatabaseBackup,
  type PostgresBackupDriver,
} from "../src/postgres-recovery.ts";

const encoder = new TextEncoder();
const databaseBytes = encoder.encode("synthetic PostgreSQL custom dump");
const backupId = asNativeId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const options: BackupOperationOptions = {
  backupId,
  createdAt: new Date("2026-09-25T00:00:00.000Z"),
  maxArtifactBytes: 1024,
};
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function isolatedRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pos-native-postgres-recovery-"));
  roots.push(root);
  return root;
}

function fixtureDriver(
  targetEmpty = true,
  assets: readonly BackupSourceAsset[] = [],
): PostgresBackupDriver & {
  restoredBytes?: Uint8Array;
  inspected: boolean;
} {
  return {
    inspected: false,
    async createDatabaseDump() {
      return Uint8Array.from(databaseBytes);
    },
    async listAssets() {
      return assets;
    },
    async isRestoreTargetEmpty() {
      this.inspected = true;
      return targetEmpty;
    },
    async restoreDatabaseDump(bytes) {
      this.restoredBytes = Uint8Array.from(bytes);
    },
  };
}

function readingStore(read: AssetStore["read"]): AssetStore {
  return {
    stage: async () => {
      throw new Error("not used");
    },
    read,
    verify: async () => false,
    discard: async () => undefined,
  };
}

test("creates a manifest-verified PostgreSQL backup without asset bytes", async () => {
  const root = await isolatedRoot();
  const created = await createPostgresDatabaseBackup(
    root,
    fixtureDriver(),
    {
      schemaVersion: "0007",
      applicationVersion: "0.1.0",
      databaseDumpFormat: "postgresql-custom-v1",
      assetStoreFormat: "filesystem-v1",
    },
    options,
  );

  expect(created.manifest.database.byteSize).toBe(databaseBytes.byteLength);
  expect(created.manifest.assets).toEqual([]);
});

test("creates a full-state backup from only PostgreSQL-declared opaque asset keys", async () => {
  const root = await isolatedRoot();
  const assetId = asNativeId("11111111-1111-4111-8111-111111111111");
  const storageKey = asAssetStorageKey(`asset-${assetId}`);
  const bytes = encoder.encode("synthetic asset");
  const receipt = {
    assetId,
    storageKey,
    byteSize: bytes.byteLength,
    sha256: sha256ForBytes(bytes),
  };
  const reads: string[] = [];

  const created = await createPostgresApplicationBackup(
    root,
    fixtureDriver(true, [receipt]),
    readingStore(async (key) => {
      reads.push(key);
      return Uint8Array.from(bytes);
    }),
    {
      schemaVersion: "0007",
      applicationVersion: "0.1.0",
      databaseDumpFormat: "postgresql-custom-v1",
      assetStoreFormat: "filesystem-v1",
    },
    options,
  );

  expect(reads).toEqual([storageKey]);
  expect(created.manifest.assets).toHaveLength(1);
  expect(created.manifest.assets[0]).toMatchObject(receipt);
});

test("publishes nothing when a PostgreSQL-declared asset fails verification", async () => {
  const root = await isolatedRoot();
  const assetId = asNativeId("11111111-1111-4111-8111-111111111111");
  const storageKey = asAssetStorageKey(`asset-${assetId}`);
  const expected = encoder.encode("expected");
  const receipt = {
    assetId,
    storageKey,
    byteSize: expected.byteLength,
    sha256: sha256ForBytes(expected),
  };

  await expect(
    createPostgresApplicationBackup(
      root,
      fixtureDriver(true, [receipt]),
      readingStore(async () => encoder.encode("changed")),
      {
        schemaVersion: "0007",
        applicationVersion: "0.1.0",
        databaseDumpFormat: "postgresql-custom-v1",
        assetStoreFormat: "filesystem-v1",
      },
      options,
    ),
  ).rejects.toThrow("backup source asset receipt does not match bytes");
  await expect(readdir(root)).resolves.toEqual([]);
});

test("restores only verified database bytes into an empty target", async () => {
  const root = await isolatedRoot();
  await createPostgresDatabaseBackup(
    root,
    fixtureDriver(),
    {
      schemaVersion: "0007",
      applicationVersion: "0.1.0",
      databaseDumpFormat: "postgresql-custom-v1",
      assetStoreFormat: "filesystem-v1",
    },
    options,
  );
  const restoreDriver = fixtureDriver();

  const manifest = await restorePostgresDatabaseBackup(
    root,
    backupId,
    restoreDriver,
    options,
  );

  expect(restoreDriver.inspected).toBe(true);
  expect(restoreDriver.restoredBytes).toEqual(databaseBytes);
  expect(manifest.backupId).toBe(backupId);
});

test("refuses a non-empty restore target before sending dump bytes", async () => {
  const root = await isolatedRoot();
  await createPostgresDatabaseBackup(
    root,
    fixtureDriver(),
    {
      schemaVersion: "0007",
      applicationVersion: "0.1.0",
      databaseDumpFormat: "postgresql-custom-v1",
      assetStoreFormat: "filesystem-v1",
    },
    options,
  );
  const restoreDriver = fixtureDriver(false);

  await expect(
    restorePostgresDatabaseBackup(root, backupId, restoreDriver, options),
  ).rejects.toThrowError(
    new ValidationError("PostgreSQL restore target must be empty"),
  );
  expect(restoreDriver.restoredBytes).toBeUndefined();
});

test("rejects a tampered dump before inspecting or mutating the target", async () => {
  const root = await isolatedRoot();
  const created = await createPostgresDatabaseBackup(
    root,
    fixtureDriver(),
    {
      schemaVersion: "0007",
      applicationVersion: "0.1.0",
      databaseDumpFormat: "postgresql-custom-v1",
      assetStoreFormat: "filesystem-v1",
    },
    options,
  );
  await writeFile(
    join(created.directory, "database", "canonical.dump"),
    "tampered",
  );
  const restoreDriver = fixtureDriver();

  await expect(
    restorePostgresDatabaseBackup(root, backupId, restoreDriver, options),
  ).rejects.toThrow("backup artifact integrity check failed");
  expect(restoreDriver.inspected).toBe(false);
  expect(restoreDriver.restoredBytes).toBeUndefined();
});
