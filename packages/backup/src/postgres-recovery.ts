import { type NativeId, ValidationError } from "../../domain/src/ids.ts";
import type { AssetStore } from "../../assets/src/asset-storage.ts";
import type {
  BackupManifest,
  BackupSourceAsset,
  BackupSourceMetadata,
} from "./backup-manifest.ts";
import {
  createFilesystemBackup,
  readVerifiedApplicationBackup,
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

export interface AssetRestoreTarget {
  isEmpty(): Promise<boolean>;
  stage(
    asset: BackupManifest["assets"][number],
    bytes: Uint8Array,
  ): Promise<void>;
  verify(asset: BackupManifest["assets"][number]): Promise<boolean>;
  discard(asset: BackupManifest["assets"][number]): Promise<void>;
}

export class IncompleteApplicationRestoreError extends Error {
  readonly databaseRestored = true;

  constructor(cause: unknown) {
    super(
      "application restore integrity verification failed after PostgreSQL restore; preserve both targets for recovery",
      { cause },
    );
    this.name = "IncompleteApplicationRestoreError";
  }
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

export async function restorePostgresApplicationBackup(
  backupRoot: string,
  backupId: NativeId,
  driver: PostgresBackupDriver,
  assetTarget: AssetRestoreTarget,
  options: BackupOperationOptions,
): Promise<BackupManifest> {
  const verified = await readVerifiedApplicationBackup(
    backupRoot,
    backupId,
    options,
  );
  if (!(await driver.isRestoreTargetEmpty())) {
    throw new ValidationError("PostgreSQL restore target must be empty");
  }
  if (!(await assetTarget.isEmpty())) {
    throw new ValidationError("asset restore target must be empty");
  }

  const staged: BackupManifest["assets"][number][] = [];
  try {
    for (const asset of verified.assets) {
      await assetTarget.stage(asset.descriptor, asset.bytes);
      staged.push(asset.descriptor);
    }
    await driver.restoreDatabaseDump(verified.bytes);
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    for (const asset of staged.reverse()) {
      await assetTarget.discard(asset).catch((cleanupError: unknown) => {
        cleanupErrors.push(cleanupError);
      });
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "application restore failed and asset compensation was incomplete",
        { cause: error },
      );
    }
    throw error;
  }

  try {
    requireMatchingReceipts(
      verified.manifest.assets,
      await driver.listAssets(),
    );
    for (const asset of verified.manifest.assets) {
      if (!(await assetTarget.verify(asset))) {
        throw new ValidationError("restored asset integrity check failed");
      }
    }
  } catch (error) {
    throw new IncompleteApplicationRestoreError(error);
  }
  return verified.manifest;
}

function requireMatchingReceipts(
  expected: readonly BackupSourceAsset[],
  actual: readonly BackupSourceAsset[],
): void {
  const actualById = new Map(actual.map((asset) => [asset.assetId, asset]));
  if (
    expected.length !== actual.length ||
    actualById.size !== actual.length ||
    expected.some((asset) => {
      const candidate = actualById.get(asset.assetId);
      return (
        !candidate ||
        candidate.assetId !== asset.assetId ||
        candidate.storageKey !== asset.storageKey ||
        candidate.byteSize !== asset.byteSize ||
        candidate.sha256 !== asset.sha256
      );
    })
  ) {
    throw new ValidationError("restored asset receipts do not match backup");
  }
}
