import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
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
    validateAssetByteSize(input.bytes.byteLength, this.maxBytes);
    const storageKey = storageKeyForAsset(input.id);
    const finalPath = this.pathFor(storageKey);
    await this.requireMissing(finalPath);

    const temporaryPath = resolve(
      this.canonicalRoot,
      `.pos-native-asset-${randomUUID()}.tmp`,
    );
    this.requireContained(temporaryPath);
    let handle: FileHandle | undefined;

    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(input.bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await link(temporaryPath, finalPath);
      await unlink(temporaryPath);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }

    return {
      id: input.id,
      ...metadata,
      storageKey,
      byteSize: input.bytes.byteLength,
      sha256: digest(input.bytes),
    };
  }

  async read(storageKey: AssetStorageKey): Promise<Uint8Array> {
    const candidate = this.pathFor(storageKey);
    const information = await lstat(candidate);
    if (!information.isFile() || information.isSymbolicLink()) {
      throw new ValidationError("asset storage target must be a regular file");
    }
    validateAssetByteSize(information.size, this.maxBytes);
    return await readFile(candidate);
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
}
