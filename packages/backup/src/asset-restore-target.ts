import { lstat, readdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";

import { FilesystemAssetStore } from "../../assets/src/filesystem-asset-store.ts";
import { ValidationError } from "../../domain/src/ids.ts";
import type { BackupAssetDescriptor } from "./backup-manifest.ts";
import type { AssetRestoreTarget } from "./postgres-recovery.ts";

export class FilesystemAssetRestoreTarget implements AssetRestoreTarget {
  static async create(
    configuredRoot: string,
    maxBytes: number,
  ): Promise<FilesystemAssetRestoreTarget> {
    if (
      typeof configuredRoot !== "string" ||
      configuredRoot.trim().length === 0
    ) {
      throw new ValidationError("asset restore target is required");
    }
    const resolved = resolve(configuredRoot);
    const information = await lstat(resolved);
    if (!information.isDirectory() || information.isSymbolicLink()) {
      throw new ValidationError(
        "asset restore target must be a regular directory",
      );
    }
    const canonicalRoot = await realpath(resolved);
    const target = new FilesystemAssetRestoreTarget(
      canonicalRoot,
      await FilesystemAssetStore.create(canonicalRoot, { maxBytes }),
    );
    if (!(await target.isEmpty())) {
      throw new ValidationError("asset restore target must be empty");
    }
    return target;
  }

  private constructor(
    private readonly root: string,
    private readonly store: FilesystemAssetStore,
  ) {}

  async isEmpty(): Promise<boolean> {
    return (await readdir(this.root)).length === 0;
  }

  async stage(asset: BackupAssetDescriptor, bytes: Uint8Array): Promise<void> {
    const receipt = await this.store.stage({
      id: asset.assetId,
      originalFilename: "restored-asset",
      mimeType: "application/octet-stream",
      bytes,
    });
    if (
      receipt.storageKey !== asset.storageKey ||
      receipt.byteSize !== asset.byteSize ||
      receipt.sha256 !== asset.sha256
    ) {
      const mismatch = new ValidationError(
        "restored asset receipt does not match backup",
      );
      try {
        await this.store.discard(receipt.storageKey);
      } catch (cleanupError) {
        throw new AggregateError(
          [mismatch, cleanupError],
          "restored asset receipt mismatch and cleanup failed",
          { cause: cleanupError },
        );
      }
      throw mismatch;
    }
  }

  async verify(asset: BackupAssetDescriptor): Promise<boolean> {
    return this.store.verify(asset);
  }

  async discard(asset: BackupAssetDescriptor): Promise<void> {
    await this.store.discard(asset.storageKey);
  }
}
