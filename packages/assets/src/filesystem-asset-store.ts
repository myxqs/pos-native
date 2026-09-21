import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  rm,
  unlink,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { ValidationError } from "../../domain/src/ids.ts";
import {
  asAssetStorageKey,
  DEFAULT_MAX_ASSET_BYTES,
  normaliseAssetMetadata,
  storageKeyForAsset,
  validateAssetByteSize,
} from "./asset-storage.ts";
import type {
  AssetStageInput,
  AssetStorageKey,
  AssetStore,
  AssetStoreReceipt,
  StagedAsset,
} from "./asset-storage.ts";

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isRegularFile(information: {
  isFile(): boolean;
  isSymbolicLink(): boolean;
}): boolean {
  return information.isFile() && !information.isSymbolicLink();
}

function isSameFile(
  left: { readonly dev: number; readonly ino: number },
  right: { readonly dev: number; readonly ino: number },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

export class FilesystemAssetStore implements AssetStore {
  static async create(
    configuredRoot: string,
    options: { readonly maxBytes?: number } = {},
  ): Promise<FilesystemAssetStore> {
    if (
      typeof configuredRoot !== "string" ||
      configuredRoot.trim().length === 0
    ) {
      throw new ValidationError("asset root is required");
    }

    const maxBytes = options.maxBytes ?? DEFAULT_MAX_ASSET_BYTES;
    validateAssetByteSize(0, maxBytes);
    const resolvedRoot = resolve(configuredRoot);
    await mkdir(resolvedRoot, { recursive: true });
    return new FilesystemAssetStore(await realpath(resolvedRoot), maxBytes);
  }

  private constructor(
    private readonly canonicalRoot: string,
    private readonly maxBytes: number,
  ) {}

  async stage(input: AssetStageInput): Promise<StagedAsset> {
    const metadata = normaliseAssetMetadata(input);
    const ownedBytes = Uint8Array.from(input.bytes);
    validateAssetByteSize(ownedBytes.byteLength, this.maxBytes);
    const sha256 = digest(ownedBytes);
    const storageKey = storageKeyForAsset(input.id);
    const finalPath = this.pathFor(storageKey);
    await this.requireMissing(finalPath);

    const temporaryPath = resolve(
      this.canonicalRoot,
      `.pos-native-asset-${randomUUID()}.tmp`,
    );
    this.requireContained(temporaryPath);
    let handle: FileHandle | undefined;
    let published = false;

    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(ownedBytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await link(temporaryPath, finalPath);
      published = true;
      try {
        await unlink(temporaryPath);
      } catch {
        await rm(temporaryPath, { force: true });
      }
    } catch (error) {
      await handle?.close().catch(() => undefined);
      const cleanupFailures: unknown[] = [];
      await rm(temporaryPath, { force: true }).catch(
        (cleanupError: unknown) => {
          cleanupFailures.push(cleanupError);
        },
      );
      if (published) {
        await unlink(finalPath).catch((cleanupError: unknown) => {
          cleanupFailures.push(cleanupError);
        });
      }
      if (cleanupFailures.length > 0) {
        throw new AggregateError(
          [error, ...cleanupFailures],
          "asset staging and cleanup failed",
          { cause: error },
        );
      }
      throw error;
    }

    return {
      id: input.id,
      ...metadata,
      storageKey,
      byteSize: ownedBytes.byteLength,
      sha256,
    };
  }

  async read(storageKey: AssetStorageKey): Promise<Uint8Array> {
    const candidate = this.pathFor(storageKey);
    const pathInformationBeforeOpen = await lstat(candidate);
    if (!isRegularFile(pathInformationBeforeOpen)) {
      throw new ValidationError("asset storage target must be a regular file");
    }

    const noFollow = constants.O_NOFOLLOW ?? 0;
    const handle = await open(candidate, constants.O_RDONLY | noFollow);
    try {
      const openedInformation = await handle.stat();
      const pathInformationAfterOpen = await lstat(candidate);
      if (
        !isRegularFile(openedInformation) ||
        !isRegularFile(pathInformationAfterOpen) ||
        !isSameFile(pathInformationBeforeOpen, openedInformation) ||
        !isSameFile(openedInformation, pathInformationAfterOpen)
      ) {
        throw new ValidationError("asset storage target changed during read");
      }
      validateAssetByteSize(openedInformation.size, this.maxBytes);
      return await this.readBounded(handle);
    } finally {
      await handle.close();
    }
  }

  async verify(receipt: AssetStoreReceipt): Promise<boolean> {
    const bytes = await this.read(receipt.storageKey);
    return (
      bytes.byteLength === receipt.byteSize && digest(bytes) === receipt.sha256
    );
  }

  async discard(storageKey: AssetStorageKey): Promise<void> {
    const candidate = this.pathFor(storageKey);
    let information;
    try {
      information = await lstat(candidate);
    } catch (error) {
      if (isMissingFile(error)) return;
      throw error;
    }

    if (!information.isFile() || information.isSymbolicLink()) {
      throw new ValidationError("asset storage target must be a regular file");
    }
    await unlink(candidate);
  }

  private pathFor(storageKey: AssetStorageKey): string {
    const candidate = resolve(
      this.canonicalRoot,
      asAssetStorageKey(storageKey),
    );
    this.requireContained(candidate);
    return candidate;
  }

  private requireContained(candidate: string): void {
    const candidateRelative = relative(this.canonicalRoot, candidate);
    if (
      candidateRelative.length === 0 ||
      candidateRelative === ".." ||
      candidateRelative.startsWith(
        `..${process.platform === "win32" ? "\\" : "/"}`,
      ) ||
      isAbsolute(candidateRelative)
    ) {
      throw new ValidationError("asset storage target escapes its root");
    }
  }

  private async requireMissing(candidate: string): Promise<void> {
    try {
      await lstat(candidate);
    } catch (error) {
      if (isMissingFile(error)) return;
      throw error;
    }
    throw new ValidationError("asset storage target already exists");
  }

  private async readBounded(handle: FileHandle): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let position = 0;

    while (true) {
      const remainingBudget = this.maxBytes + 1 - totalBytes;
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remainingBudget));
      const { bytesRead } = await handle.read(
        buffer,
        0,
        buffer.byteLength,
        position,
      );
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      validateAssetByteSize(totalBytes, this.maxBytes);
      chunks.push(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }

    return Buffer.concat(chunks, totalBytes);
  }
}
