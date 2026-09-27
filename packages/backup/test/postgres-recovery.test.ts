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
  IncompleteApplicationRestoreError,
  createPostgresDatabaseBackup,
  createPostgresApplicationBackup,
  restorePostgresDatabaseBackup,
  restorePostgresApplicationBackup,
  type AssetRestoreTarget,
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

test("restores verified asset bytes before the database and cross-checks receipts", async () => {
  const root = await isolatedRoot();
  const assetId = asNativeId("11111111-1111-4111-8111-111111111111");
  const storageKey = asAssetStorageKey(`asset-${assetId}`);
  const bytes = encoder.encode("restore asset");
  const receipt = {
    assetId,
    storageKey,
    byteSize: bytes.byteLength,
    sha256: sha256ForBytes(bytes),
  };
  await createPostgresApplicationBackup(
    root,
    fixtureDriver(true, [receipt]),
    readingStore(async () => bytes),
    {
      schemaVersion: "0007",
      applicationVersion: "0.1.0",
      databaseDumpFormat: "postgresql-custom-v1",
      assetStoreFormat: "filesystem-v1",
    },
    options,
  );
  const events: string[] = [];
  const target = fixtureAssetTarget(events);
  const driver = fixtureDriver(true, [receipt]);
  const originalRestore = driver.restoreDatabaseDump;
  driver.restoreDatabaseDump = async (dump) => {
    events.push("database");
    await originalRestore.call(driver, dump);
  };

  await restorePostgresApplicationBackup(
    root,
    backupId,
    driver,
    target,
    options,
  );

  expect(events).toEqual([
    "empty",
    `stage:${storageKey}`,
    "database",
    `verify:${storageKey}`,
  ]);
  expect(driver.restoredBytes).toEqual(databaseBytes);
});

test("compensates only assets staged by a failed database restore", async () => {
  const root = await isolatedRoot();
  const assetId = asNativeId("11111111-1111-4111-8111-111111111111");
  const storageKey = asAssetStorageKey(`asset-${assetId}`);
  const bytes = encoder.encode("restore asset");
  const receipt = {
    assetId,
    storageKey,
    byteSize: bytes.byteLength,
    sha256: sha256ForBytes(bytes),
  };
  await createPostgresApplicationBackup(
    root,
    fixtureDriver(true, [receipt]),
    readingStore(async () => bytes),
    {
      schemaVersion: "0007",
      applicationVersion: "0.1.0",
      databaseDumpFormat: "postgresql-custom-v1",
      assetStoreFormat: "filesystem-v1",
    },
    options,
  );
  const events: string[] = [];
  const target = fixtureAssetTarget(events);
  const driver = fixtureDriver(true, [receipt]);
  driver.restoreDatabaseDump = async () => {
    throw new Error("restore failed");
  };

  await expect(
    restorePostgresApplicationBackup(root, backupId, driver, target, options),
  ).rejects.toThrow("restore failed");
  expect(events).toEqual([
    "empty",
    `stage:${storageKey}`,
    `discard:${storageKey}`,
  ]);
});

test("verifies every backup artifact before inspecting either restore target", async () => {
  const root = await isolatedRoot();
  const firstId = asNativeId("11111111-1111-4111-8111-111111111111");
  const secondId = asNativeId("22222222-2222-4222-8222-222222222222");
  const firstBytes = encoder.encode("first asset");
  const secondBytes = encoder.encode("second asset");
  const firstReceipt = {
    assetId: firstId,
    storageKey: asAssetStorageKey(`asset-${firstId}`),
    byteSize: firstBytes.byteLength,
    sha256: sha256ForBytes(firstBytes),
  };
  const secondReceipt = {
    assetId: secondId,
    storageKey: asAssetStorageKey(`asset-${secondId}`),
    byteSize: secondBytes.byteLength,
    sha256: sha256ForBytes(secondBytes),
  };
  const receipts = [firstReceipt, secondReceipt];
  const created = await createPostgresApplicationBackup(
    root,
    fixtureDriver(true, receipts),
    readingStore(async (key) =>
      key === firstReceipt.storageKey ? firstBytes : secondBytes,
    ),
    {
      schemaVersion: "0007",
      applicationVersion: "0.1.0",
      databaseDumpFormat: "postgresql-custom-v1",
      assetStoreFormat: "filesystem-v1",
    },
    options,
  );
  await writeFile(
    join(created.directory, `assets/${secondReceipt.storageKey}`),
    "tampered",
  );
  const events: string[] = [];
  const driver = fixtureDriver(true, receipts);

  await expect(
    restorePostgresApplicationBackup(
      root,
      backupId,
      driver,
      fixtureAssetTarget(events),
      options,
    ),
  ).rejects.toThrow("backup artifact integrity check failed");
  expect(driver.inspected).toBe(false);
  expect(events).toEqual([]);
});

test("a non-empty PostgreSQL target causes no asset mutation", async () => {
  const root = await isolatedRoot();
  const assetId = asNativeId("11111111-1111-4111-8111-111111111111");
  const bytes = encoder.encode("restore asset");
  const receipt = {
    assetId,
    storageKey: asAssetStorageKey(`asset-${assetId}`),
    byteSize: bytes.byteLength,
    sha256: sha256ForBytes(bytes),
  };
  await createPostgresApplicationBackup(
    root,
    fixtureDriver(true, [receipt]),
    readingStore(async () => bytes),
    {
      schemaVersion: "0007",
      applicationVersion: "0.1.0",
      databaseDumpFormat: "postgresql-custom-v1",
      assetStoreFormat: "filesystem-v1",
    },
    options,
  );
  const events: string[] = [];
  const driver = fixtureDriver(false, [receipt]);

  await expect(
    restorePostgresApplicationBackup(
      root,
      backupId,
      driver,
      fixtureAssetTarget(events),
      options,
    ),
  ).rejects.toThrow("PostgreSQL restore target must be empty");
  expect(events).toEqual([]);
  expect(driver.restoredBytes).toBeUndefined();
});

test("a non-empty asset target causes no restore mutation", async () => {
  const root = await isolatedRoot();
  const assetId = asNativeId("11111111-1111-4111-8111-111111111111");
  const bytes = encoder.encode("restore asset");
  const receipt = {
    assetId,
    storageKey: asAssetStorageKey(`asset-${assetId}`),
    byteSize: bytes.byteLength,
    sha256: sha256ForBytes(bytes),
  };
  await createPostgresApplicationBackup(
    root,
    fixtureDriver(true, [receipt]),
    readingStore(async () => bytes),
    {
      schemaVersion: "0007",
      applicationVersion: "0.1.0",
      databaseDumpFormat: "postgresql-custom-v1",
      assetStoreFormat: "filesystem-v1",
    },
    options,
  );
  const events: string[] = [];
  const driver = fixtureDriver(true, [receipt]);

  await expect(
    restorePostgresApplicationBackup(
      root,
      backupId,
      driver,
      fixtureAssetTarget(events, false),
      options,
    ),
  ).rejects.toThrow("asset restore target must be empty");
  expect(events).toEqual(["empty"]);
  expect(driver.restoredBytes).toBeUndefined();
});

test("compensates completed stages when a later asset stage fails", async () => {
  const root = await isolatedRoot();
  const firstId = asNativeId("11111111-1111-4111-8111-111111111111");
  const secondId = asNativeId("22222222-2222-4222-8222-222222222222");
  const firstBytes = encoder.encode("first asset");
  const secondBytes = encoder.encode("second asset");
  const firstReceipt = {
    assetId: firstId,
    storageKey: asAssetStorageKey(`asset-${firstId}`),
    byteSize: firstBytes.byteLength,
    sha256: sha256ForBytes(firstBytes),
  };
  const secondReceipt = {
    assetId: secondId,
    storageKey: asAssetStorageKey(`asset-${secondId}`),
    byteSize: secondBytes.byteLength,
    sha256: sha256ForBytes(secondBytes),
  };
  const receipts = [firstReceipt, secondReceipt];
  await createPostgresApplicationBackup(
    root,
    fixtureDriver(true, receipts),
    readingStore(async (key) =>
      key === firstReceipt.storageKey ? firstBytes : secondBytes,
    ),
    {
      schemaVersion: "0007",
      applicationVersion: "0.1.0",
      databaseDumpFormat: "postgresql-custom-v1",
      assetStoreFormat: "filesystem-v1",
    },
    options,
  );
  const events: string[] = [];
  const target = fixtureAssetTarget(events);
  target.stage = async (asset) => {
    events.push(`stage:${asset.storageKey}`);
    if (asset.assetId === secondId) throw new Error("second stage failed");
  };
  const driver = fixtureDriver(true, receipts);

  await expect(
    restorePostgresApplicationBackup(root, backupId, driver, target, options),
  ).rejects.toThrow("second stage failed");
  expect(events).toEqual([
    "empty",
    `stage:${firstReceipt.storageKey}`,
    `stage:${secondReceipt.storageKey}`,
    `discard:${firstReceipt.storageKey}`,
  ]);
  expect(driver.restoredBytes).toBeUndefined();
});

test("reports both the restore and compensation failures", async () => {
  const root = await isolatedRoot();
  const assetId = asNativeId("11111111-1111-4111-8111-111111111111");
  const bytes = encoder.encode("restore asset");
  const receipt = {
    assetId,
    storageKey: asAssetStorageKey(`asset-${assetId}`),
    byteSize: bytes.byteLength,
    sha256: sha256ForBytes(bytes),
  };
  await createPostgresApplicationBackup(
    root,
    fixtureDriver(true, [receipt]),
    readingStore(async () => bytes),
    {
      schemaVersion: "0007",
      applicationVersion: "0.1.0",
      databaseDumpFormat: "postgresql-custom-v1",
      assetStoreFormat: "filesystem-v1",
    },
    options,
  );
  const target = fixtureAssetTarget([]);
  target.discard = async () => {
    throw new Error("discard failed");
  };
  const driver = fixtureDriver(true, [receipt]);
  driver.restoreDatabaseDump = async () => {
    throw new Error("database restore failed");
  };

  const failure = await restorePostgresApplicationBackup(
    root,
    backupId,
    driver,
    target,
    options,
  ).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure).toMatchObject({
    message: "application restore failed and asset compensation was incomplete",
    errors: [
      expect.objectContaining({ message: "database restore failed" }),
      expect.objectContaining({ message: "discard failed" }),
    ],
  });
});

test("preserves both targets and reports an incomplete restore on receipt mismatch", async () => {
  const root = await isolatedRoot();
  const assetId = asNativeId("11111111-1111-4111-8111-111111111111");
  const bytes = encoder.encode("restore asset");
  const receipt = {
    assetId,
    storageKey: asAssetStorageKey(`asset-${assetId}`),
    byteSize: bytes.byteLength,
    sha256: sha256ForBytes(bytes),
  };
  await createPostgresApplicationBackup(
    root,
    fixtureDriver(true, [receipt]),
    readingStore(async () => bytes),
    {
      schemaVersion: "0007",
      applicationVersion: "0.1.0",
      databaseDumpFormat: "postgresql-custom-v1",
      assetStoreFormat: "filesystem-v1",
    },
    options,
  );
  const events: string[] = [];
  const mismatched = { ...receipt, sha256: "f".repeat(64) };
  const driver = fixtureDriver(true, [mismatched]);

  const failure = await restorePostgresApplicationBackup(
    root,
    backupId,
    driver,
    fixtureAssetTarget(events),
    options,
  ).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(IncompleteApplicationRestoreError);
  expect(failure).toMatchObject({ databaseRestored: true });
  expect((failure as Error).cause).toMatchObject({
    message: "restored asset receipts do not match backup",
  });
  expect(events).toEqual(["empty", `stage:${receipt.storageKey}`]);
  expect(driver.restoredBytes).toEqual(databaseBytes);
});

test("preserves both targets and reports an incomplete restore on file verification failure", async () => {
  const root = await isolatedRoot();
  const assetId = asNativeId("11111111-1111-4111-8111-111111111111");
  const bytes = encoder.encode("restore asset");
  const receipt = {
    assetId,
    storageKey: asAssetStorageKey(`asset-${assetId}`),
    byteSize: bytes.byteLength,
    sha256: sha256ForBytes(bytes),
  };
  await createPostgresApplicationBackup(
    root,
    fixtureDriver(true, [receipt]),
    readingStore(async () => bytes),
    {
      schemaVersion: "0007",
      applicationVersion: "0.1.0",
      databaseDumpFormat: "postgresql-custom-v1",
      assetStoreFormat: "filesystem-v1",
    },
    options,
  );
  const events: string[] = [];
  const target = fixtureAssetTarget(events);
  target.verify = async (asset) => {
    events.push(`verify:${asset.storageKey}`);
    return false;
  };
  const driver = fixtureDriver(true, [receipt]);

  const failure = await restorePostgresApplicationBackup(
    root,
    backupId,
    driver,
    target,
    options,
  ).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(IncompleteApplicationRestoreError);
  expect(failure).toMatchObject({ databaseRestored: true });
  expect((failure as Error).cause).toMatchObject({
    message: "restored asset integrity check failed",
  });
  expect(events).toEqual([
    "empty",
    `stage:${receipt.storageKey}`,
    `verify:${receipt.storageKey}`,
  ]);
  expect(driver.restoredBytes).toEqual(databaseBytes);
});

function fixtureAssetTarget(
  events: string[],
  empty = true,
): AssetRestoreTarget {
  return {
    async isEmpty() {
      events.push("empty");
      return empty;
    },
    async stage(asset) {
      events.push(`stage:${asset.storageKey}`);
    },
    async verify(asset) {
      events.push(`verify:${asset.storageKey}`);
      return true;
    },
    async discard(asset) {
      events.push(`discard:${asset.storageKey}`);
    },
  };
}
