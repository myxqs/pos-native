import type { NativeId } from "../../domain/src/ids.ts";
import { asNativeId, ValidationError } from "../../domain/src/ids.ts";

export const DEFAULT_MAX_ASSET_BYTES = 50 * 1024 * 1024;

export type AssetStorageKey = string & {
  readonly __brand: "AssetStorageKey";
};

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

export interface StagedAsset extends AssetStoreReceipt {
  readonly id: NativeId;
  readonly originalFilename: string;
  readonly mimeType: string;
}

export interface AssetStore {
  stage(input: AssetStageInput): Promise<StagedAsset>;
  read(storageKey: AssetStorageKey): Promise<Uint8Array>;
  verify(receipt: AssetStoreReceipt): Promise<boolean>;
  discard(storageKey: AssetStorageKey): Promise<void>;
}

export interface AssetMetadataInput {
  readonly originalFilename: string;
  readonly mimeType: string;
}

export interface NormalisedAssetMetadata {
  readonly originalFilename: string;
  readonly mimeType: string;
}

const STORAGE_KEY_PREFIX = "asset-";
const MIME_TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
const MIME_TYPE_PATTERN = new RegExp(`^${MIME_TOKEN}/${MIME_TOKEN}$`, "u");

function hasUnsafeFilenameCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      character === "/" ||
      character === "\\" ||
      codePoint === undefined ||
      codePoint <= 0x1f ||
      codePoint === 0x7f
    );
  });
}

export function asAssetStorageKey(value: string): AssetStorageKey {
  if (typeof value !== "string" || !value.startsWith(STORAGE_KEY_PREFIX)) {
    throw new ValidationError("asset storage key is invalid");
  }

  asNativeId(value.slice(STORAGE_KEY_PREFIX.length));
  return value as AssetStorageKey;
}

export function storageKeyForAsset(id: NativeId): AssetStorageKey {
  return asAssetStorageKey(`${STORAGE_KEY_PREFIX}${asNativeId(id)}`);
}

export function normaliseAssetMetadata(
  input: AssetMetadataInput,
): NormalisedAssetMetadata {
  if (
    typeof input.originalFilename !== "string" ||
    typeof input.mimeType !== "string"
  ) {
    throw new ValidationError("asset metadata must contain strings");
  }

  const originalFilename = input.originalFilename.normalize("NFC").trim();
  if (
    originalFilename.length === 0 ||
    originalFilename.length > 255 ||
    hasUnsafeFilenameCharacter(originalFilename)
  ) {
    throw new ValidationError("asset filename is invalid");
  }

  const mimeType = input.mimeType.trim().toLowerCase();
  if (!MIME_TYPE_PATTERN.test(mimeType)) {
    throw new ValidationError("asset MIME type is invalid");
  }

  return { originalFilename, mimeType };
}

export function validateAssetByteSize(
  byteSize: number,
  maxBytes: number,
): number {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new ValidationError(
      "asset byte limit must be a positive safe integer",
    );
  }

  if (!Number.isSafeInteger(byteSize) || byteSize < 0 || byteSize > maxBytes) {
    throw new ValidationError("asset byte size exceeds the configured limit");
  }

  return byteSize;
}
