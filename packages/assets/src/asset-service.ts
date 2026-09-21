import { createHash } from "node:crypto";

import {
  createAssetMutation,
  prepareAssetCreation,
  storageKeyForAsset,
  type Asset,
  type CreateAssetCommand,
  type CreateAssetDependencies,
  type AssetStorageKey,
} from "../../domain/src/asset.ts";
import { ValidationError } from "../../domain/src/ids.ts";
import type { AssetMetadataRepository } from "../../database/src/asset-metadata-repository.ts";
import type { AssetStore } from "./asset-storage.ts";

export interface CreateStoredAssetInput extends CreateAssetCommand {
  readonly bytes: Uint8Array;
}

export interface AssetServiceDependencies extends CreateAssetDependencies {
  readonly assetStore: AssetStore;
  readonly assetRepository: AssetMetadataRepository;
}

export class AssetStorageIntegrityError extends Error {
  constructor() {
    super("staged asset receipt verification failed");
    this.name = "AssetStorageIntegrityError";
  }
}

export class AssetCompensationError extends AggregateError {
  readonly storageKey: AssetStorageKey;

  constructor(
    operationError: unknown,
    cleanupError: unknown,
    storageKey: AssetStorageKey,
  ) {
    super(
      [operationError, cleanupError],
      "asset persistence failed and storage compensation failed",
      { cause: operationError },
    );
    this.name = "AssetCompensationError";
    this.storageKey = storageKey;
  }
}

export class AssetService {
  constructor(private readonly dependencies: AssetServiceDependencies) {}

  async create(input: CreateStoredAssetInput): Promise<Asset> {
    if (typeof input !== "object" || input === null) {
      throw new ValidationError("asset creation input is invalid");
    }
    const bytes = copyAssetBytes(input.bytes);
    const prepared = prepareAssetCreation(
      toCreateAssetCommand(input),
      this.dependencies,
    );
    const expectedStorageKey = storageKeyForAsset(prepared.id);
    let stageFulfilled = false;

    try {
      const receipt = await this.dependencies.assetStore.stage({
        id: prepared.id,
        originalFilename: prepared.originalFilename,
        mimeType: prepared.mimeType,
        bytes,
      });
      stageFulfilled = true;
      const mutation = createAssetMutation(prepared, receipt);
      if (
        !receiptMatchesOwnedBytes(receipt, bytes) ||
        !(await this.dependencies.assetStore.verify(receipt))
      ) {
        throw new AssetStorageIntegrityError();
      }
      await this.dependencies.assetRepository.create(mutation);
      return mutation.asset;
    } catch (error) {
      if (!stageFulfilled) throw error;
      try {
        await this.dependencies.assetStore.discard(expectedStorageKey);
      } catch (cleanupError) {
        throw new AssetCompensationError(
          error,
          cleanupError,
          expectedStorageKey,
        );
      }
      throw error;
    }
  }
}

function copyAssetBytes(bytes: Uint8Array): Uint8Array {
  if (!(bytes instanceof Uint8Array)) {
    throw new ValidationError("asset bytes must be a Uint8Array");
  }
  return Uint8Array.from(bytes);
}

function toCreateAssetCommand(
  input: CreateStoredAssetInput,
): CreateAssetCommand {
  return {
    originalFilename: input.originalFilename,
    mimeType: input.mimeType,
    actorType: input.actorType,
    actorId: input.actorId,
    source: input.source,
    ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  };
}

function receiptMatchesOwnedBytes(
  receipt: { readonly byteSize: number; readonly sha256: string },
  bytes: Uint8Array,
): boolean {
  return (
    receipt.byteSize === bytes.byteLength &&
    receipt.sha256 === createHash("sha256").update(bytes).digest("hex")
  );
}
