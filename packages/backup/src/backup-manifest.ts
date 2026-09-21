import { createHash } from "node:crypto";

import {
  asAssetStorageKey,
  type AssetStorageKey,
} from "../../assets/src/asset-storage.ts";
import {
  asNativeId,
  type NativeId,
  ValidationError,
} from "../../domain/src/ids.ts";

export const BACKUP_FORMAT = "pos-native-backup" as const;
export const BACKUP_FORMAT_VERSION = 1 as const;
export const DATABASE_ARTIFACT_PATH = "database/canonical.dump" as const;

export interface BackupSourceMetadata {
  readonly schemaVersion: string;
  readonly applicationVersion: string;
  readonly databaseDumpFormat: "postgresql-custom-v1";
  readonly assetStoreFormat: "filesystem-v1";
}

export interface BackupSourceAsset {
  readonly assetId: NativeId;
  readonly storageKey: AssetStorageKey;
  readonly byteSize: number;
  readonly sha256: string;
}

export interface BackupArtifactDescriptor {
  readonly relativePath: string;
  readonly byteSize: number;
  readonly sha256: string;
}

export interface BackupAssetDescriptor
  extends BackupSourceAsset, BackupArtifactDescriptor {}

export interface BackupManifestInput {
  readonly backupId: NativeId;
  readonly createdAt: string;
  readonly source: BackupSourceMetadata;
  readonly database: BackupArtifactDescriptor;
  readonly assets: readonly BackupAssetDescriptor[];
}

export interface BackupManifest extends BackupManifestInput {
  readonly format: typeof BACKUP_FORMAT;
  readonly formatVersion: typeof BACKUP_FORMAT_VERSION;
  readonly manifestSha256: string;
}

type JsonRecord = Record<string, unknown>;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const METADATA_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function requireRecord(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object`);
  }

  return value as JsonRecord;
}

function requireExactKeys(
  value: JsonRecord,
  expectedKeys: readonly string[],
  label: string,
): void {
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpected.length ||
    actualKeys.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new ValidationError(`${label} has an unsupported shape`);
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${label} must be a string`);
  }

  return value;
}

function normaliseByteSize(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ValidationError(`${label} must be a non-negative safe integer`);
  }

  return value as number;
}

function normaliseSha256(value: unknown, label: string): string {
  const sha256 = requireString(value, label);
  if (!SHA256_PATTERN.test(sha256)) {
    throw new ValidationError(`${label} must be a lower-case SHA-256 digest`);
  }

  return sha256;
}

function normaliseMetadataToken(value: unknown, label: string): string {
  const token = requireString(value, label);
  if (!METADATA_TOKEN_PATTERN.test(token)) {
    throw new ValidationError(`${label} is invalid`);
  }

  return token;
}

function normaliseTimestamp(value: unknown): string {
  const timestamp = requireString(value, "backup timestamp");
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== timestamp) {
    throw new ValidationError("backup timestamp must be canonical ISO-8601");
  }

  return timestamp;
}

function normaliseSourceMetadata(
  value: BackupSourceMetadata,
): BackupSourceMetadata {
  const source = requireRecord(value, "backup source");
  requireExactKeys(
    source,
    [
      "applicationVersion",
      "assetStoreFormat",
      "databaseDumpFormat",
      "schemaVersion",
    ],
    "backup source",
  );
  const databaseDumpFormat = requireString(
    source.databaseDumpFormat,
    "database dump format",
  );
  const assetStoreFormat = requireString(
    source.assetStoreFormat,
    "asset store format",
  );
  if (databaseDumpFormat !== "postgresql-custom-v1") {
    throw new ValidationError("database dump format is unsupported");
  }
  if (assetStoreFormat !== "filesystem-v1") {
    throw new ValidationError("asset store format is unsupported");
  }

  return {
    schemaVersion: normaliseMetadataToken(
      source.schemaVersion,
      "schema version",
    ),
    applicationVersion: normaliseMetadataToken(
      source.applicationVersion,
      "application version",
    ),
    databaseDumpFormat,
    assetStoreFormat,
  };
}

function normaliseDatabaseDescriptor(
  value: BackupArtifactDescriptor,
): BackupArtifactDescriptor {
  const database = requireRecord(value, "database artifact");
  requireExactKeys(
    database,
    ["byteSize", "relativePath", "sha256"],
    "database artifact",
  );
  if (database.relativePath !== DATABASE_ARTIFACT_PATH) {
    throw new ValidationError("database artifact path is invalid");
  }

  return {
    relativePath: DATABASE_ARTIFACT_PATH,
    byteSize: normaliseByteSize(database.byteSize, "database artifact size"),
    sha256: normaliseSha256(database.sha256, "database artifact checksum"),
  };
}

function normaliseAssetDescriptor(
  value: BackupAssetDescriptor,
): BackupAssetDescriptor {
  const asset = requireRecord(value, "backup asset");
  requireExactKeys(
    asset,
    ["assetId", "byteSize", "relativePath", "sha256", "storageKey"],
    "backup asset",
  );
  const assetId = asNativeId(requireString(asset.assetId, "backup asset ID"));
  const storageKey = asAssetStorageKey(
    requireString(asset.storageKey, "backup asset storage key"),
  );
  const expectedPath = assetBackupRelativePath(storageKey);
  if (asset.relativePath !== expectedPath) {
    throw new ValidationError("backup asset path is invalid");
  }

  return {
    assetId,
    storageKey,
    relativePath: expectedPath,
    byteSize: normaliseByteSize(asset.byteSize, "backup asset size"),
    sha256: normaliseSha256(asset.sha256, "backup asset checksum"),
  };
}

function normaliseAssets(
  value: readonly BackupAssetDescriptor[],
): readonly BackupAssetDescriptor[] {
  if (!Array.isArray(value)) {
    throw new ValidationError("backup assets must be an array");
  }

  const assets = value
    .map(normaliseAssetDescriptor)
    .sort((left, right) => left.assetId.localeCompare(right.assetId));
  const assetIds = new Set<string>();
  const storageKeys = new Set<string>();
  const relativePaths = new Set<string>();
  for (const asset of assets) {
    if (
      assetIds.has(asset.assetId) ||
      storageKeys.has(asset.storageKey) ||
      relativePaths.has(asset.relativePath)
    ) {
      throw new ValidationError("backup assets must have unique identities");
    }
    assetIds.add(asset.assetId);
    storageKeys.add(asset.storageKey);
    relativePaths.add(asset.relativePath);
  }

  return assets;
}

function normaliseManifestInput(
  value: BackupManifestInput,
): BackupManifestInput {
  const input = requireRecord(value, "backup manifest");
  requireExactKeys(
    input,
    ["assets", "backupId", "createdAt", "database", "source"],
    "backup manifest",
  );
  if (!Array.isArray(input.assets)) {
    throw new ValidationError("backup assets must be an array");
  }

  return {
    backupId: asNativeId(requireString(input.backupId, "backup ID")),
    createdAt: normaliseTimestamp(input.createdAt),
    source: normaliseSourceMetadata(input.source as BackupSourceMetadata),
    database: normaliseDatabaseDescriptor(
      input.database as BackupArtifactDescriptor,
    ),
    assets: normaliseAssets(input.assets as BackupAssetDescriptor[]),
  };
}

function manifestCoreObject(input: BackupManifestInput): JsonRecord {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    backupId: input.backupId,
    createdAt: input.createdAt,
    source: {
      schemaVersion: input.source.schemaVersion,
      applicationVersion: input.source.applicationVersion,
      databaseDumpFormat: input.source.databaseDumpFormat,
      assetStoreFormat: input.source.assetStoreFormat,
    },
    database: {
      relativePath: input.database.relativePath,
      byteSize: input.database.byteSize,
      sha256: input.database.sha256,
    },
    assets: input.assets.map((asset) => ({
      assetId: asset.assetId,
      storageKey: asset.storageKey,
      relativePath: asset.relativePath,
      byteSize: asset.byteSize,
      sha256: asset.sha256,
    })),
  };
}

function serialiseCore(input: BackupManifestInput): string {
  return JSON.stringify(manifestCoreObject(input));
}

export function assetBackupRelativePath(storageKey: AssetStorageKey): string {
  return `assets/${asAssetStorageKey(storageKey)}`;
}

export function sha256ForBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function createBackupManifest(
  input: BackupManifestInput,
): BackupManifest {
  const normalised = normaliseManifestInput(input);
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    ...normalised,
    manifestSha256: sha256ForBytes(encoder.encode(serialiseCore(normalised))),
  };
}

export function serializeBackupManifest(manifest: BackupManifest): string {
  const value = requireRecord(manifest, "backup manifest");
  requireExactKeys(
    value,
    [
      "assets",
      "backupId",
      "createdAt",
      "database",
      "format",
      "formatVersion",
      "manifestSha256",
      "source",
    ],
    "backup manifest",
  );
  if (
    value.format !== BACKUP_FORMAT ||
    value.formatVersion !== BACKUP_FORMAT_VERSION
  ) {
    throw new ValidationError("backup manifest format is unsupported");
  }

  const expected = createBackupManifest({
    backupId: asNativeId(requireString(value.backupId, "backup ID")),
    createdAt: requireString(value.createdAt, "backup timestamp"),
    source: value.source as BackupSourceMetadata,
    database: value.database as BackupArtifactDescriptor,
    assets: value.assets as BackupAssetDescriptor[],
  });
  const manifestSha256 = normaliseSha256(
    value.manifestSha256,
    "manifest checksum",
  );
  if (manifestSha256 !== expected.manifestSha256) {
    throw new ValidationError(
      "backup manifest checksum does not match content",
    );
  }

  return `${JSON.stringify({ ...manifestCoreObject(expected), manifestSha256 }, null, 2)}\n`;
}

export function parseBackupManifest(serialized: string): BackupManifest {
  if (typeof serialized !== "string") {
    throw new ValidationError("backup manifest must be text");
  }

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new ValidationError("backup manifest is not valid JSON");
  }

  const parsed = requireRecord(value, "backup manifest");
  requireExactKeys(
    parsed,
    [
      "assets",
      "backupId",
      "createdAt",
      "database",
      "format",
      "formatVersion",
      "manifestSha256",
      "source",
    ],
    "backup manifest",
  );
  if (
    parsed.format !== BACKUP_FORMAT ||
    parsed.formatVersion !== BACKUP_FORMAT_VERSION
  ) {
    throw new ValidationError("backup manifest format is unsupported");
  }

  const expected = createBackupManifest({
    backupId: asNativeId(requireString(parsed.backupId, "backup ID")),
    createdAt: requireString(parsed.createdAt, "backup timestamp"),
    source: parsed.source as BackupSourceMetadata,
    database: parsed.database as BackupArtifactDescriptor,
    assets: parsed.assets as BackupAssetDescriptor[],
  });
  const manifestSha256 = normaliseSha256(
    parsed.manifestSha256,
    "manifest checksum",
  );
  if (manifestSha256 !== expected.manifestSha256) {
    throw new ValidationError(
      "backup manifest checksum does not match content",
    );
  }

  return expected;
}

const encoder = new TextEncoder();
