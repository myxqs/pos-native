import { type NativeId, ValidationError } from "../../domain/src/ids.ts";
import type { AssetStore } from "../../assets/src/asset-storage.ts";
import type {
  BackupManifest,
  BackupSourceAsset,
  BackupSourceMetadata,
} from "./backup-manifest.ts";
import {
  createFilesystemBackup,
  readVerifiedDatabaseDump,
  type BackupOperationOptions,
  type FilesystemBackupLocation,
} from "./filesystem-backup.ts";

export interface PostgresBackupDriver {
  createDatabaseDump(): Promise<Uint8Array>;
  listAssets(): Promise<readonly BackupSourceAsset[]>;
  isRestoreTargetEmpty(): Promise<boolean>;
  restoreDatabaseDump(bytes: Uint8Array): Promise<void>;
}

export async function createPostgresDatabaseBackup(
  backupRoot: string,
  driver: PostgresBackupDriver,
  metadata: BackupSourceMetadata,
  options: BackupOperationOptions,
): Promise<FilesystemBackupLocation> {
  return createFilesystemBackup(
    backupRoot,
    {
      metadata,
      async readDatabaseDump() {
        return driver.createDatabaseDump();
      },
      async listAssets() {
        return [];
      },
      async readAsset() {
        throw new ValidationError(
          "asset bytes are unavailable for this database-only backup",
        );
      },
    },
    options,
  );
}

export async function createPostgresApplicationBackup(
  backupRoot: string,
  driver: PostgresBackupDriver,
  assetStore: Pick<AssetStore, "read">,
  metadata: BackupSourceMetadata,
  options: BackupOperationOptions,
): Promise<FilesystemBackupLocation> {
  return createFilesystemBackup(
    backupRoot,
    {
      metadata,
      async readDatabaseDump() {
        return driver.createDatabaseDump();
      },
      async listAssets() {
        return driver.listAssets();
      },
      async readAsset(asset) {
        return assetStore.read(asset.storageKey);
      },
    },
    options,
  );
}

export async function restorePostgresDatabaseBackup(
  backupRoot: string,
  backupId: NativeId,
  driver: PostgresBackupDriver,
  options: BackupOperationOptions,
): Promise<BackupManifest> {
  const verified = await readVerifiedDatabaseDump(
    backupRoot,
    backupId,
    options,
  );
  if (!(await driver.isRestoreTargetEmpty())) {
    throw new ValidationError("PostgreSQL restore target must be empty");
  }

  await driver.restoreDatabaseDump(verified.bytes);
  return verified.manifest;
}
