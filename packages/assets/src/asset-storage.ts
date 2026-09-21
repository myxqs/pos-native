import type { NativeId } from "../../domain/src/ids.ts";
import {
  asAssetStorageKey,
  normaliseAssetMetadata,
  storageKeyForAsset,
  validateAssetByteSize,
} from "../../domain/src/asset.ts";
import type {
  AssetMetadataInput,
  AssetStageReceipt,
  AssetStorageKey,
  NormalisedAssetMetadata,
} from "../../domain/src/asset.ts";

export {
  asAssetStorageKey,
  normaliseAssetMetadata,
  storageKeyForAsset,
  validateAssetByteSize,
};
export type { AssetMetadataInput, AssetStorageKey, NormalisedAssetMetadata };

export const DEFAULT_MAX_ASSET_BYTES = 50 * 1024 * 1024;

export interface AssetStoreReceipt {
  readonly storageKey: AssetStorageKey;
  readonly byteSize: number;
  readonly sha256: string;
}

export interface AssetStageInput {
  readonly id: NativeId;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export type StagedAsset = AssetStageReceipt;

export interface AssetStore {
  /**
   * Stages bytes only under the exact key derived from `input.id`. A conforming
   * implementation must not publish a receipt or bytes under an unrelated key;
   * the service treats a malformed receipt as failure and will only compensate
   * its own expected key.
   */
  stage(input: AssetStageInput): Promise<StagedAsset>;
  read(storageKey: AssetStorageKey): Promise<Uint8Array>;
  verify(receipt: AssetStoreReceipt): Promise<boolean>;
  discard(storageKey: AssetStorageKey): Promise<void>;
}
