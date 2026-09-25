import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";

import { asNativeId, ValidationError } from "../../domain/src/ids.ts";
import type { BackupOperationOptions } from "../src/filesystem-backup.ts";
import {
  createPostgresDatabaseBackup,
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

function fixtureDriver(targetEmpty = true): PostgresBackupDriver & {
  restoredBytes?: Uint8Array;
  inspected: boolean;
} {
  return {
    inspected: false,
    async createDatabaseDump() {
      return Uint8Array.from(databaseBytes);
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
