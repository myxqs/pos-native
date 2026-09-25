import { type NativeId, ValidationError } from "../../domain/src/ids.ts";
import type {
  BackupManifest,
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
