import type { AuditActorType, AuditEvent, Revision } from "./audit.ts";
import { asNativeId, type NativeId, ValidationError } from "./ids.ts";

export type AssetStorageKey = string & {
  readonly __brand: "AssetStorageKey";
};

export interface AssetMetadataInput {
  readonly originalFilename: string;
  readonly mimeType: string;
}

export interface NormalisedAssetMetadata {
  readonly originalFilename: string;
  readonly mimeType: string;
}

export interface AssetStageReceipt extends NormalisedAssetMetadata {
  readonly id: NativeId;
  readonly storageKey: AssetStorageKey;
  readonly byteSize: number;
  readonly sha256: string;
}

export interface CreateAssetCommand extends AssetMetadataInput {
  readonly actorType: AuditActorType;
  readonly actorId: string;
  readonly source: string;
  readonly requestId?: string;
  readonly runId?: string;
  readonly reason?: string;
}

export interface CreateAssetDependencies {
  readonly newId: () => string;
  readonly now: () => Date;
}

export interface Asset {
  readonly id: NativeId;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly storageKey: AssetStorageKey;
  readonly createdAt: string;
  readonly provenance: Readonly<Record<string, string>>;
}

export interface PreparedAssetCreation extends NormalisedAssetMetadata {
  readonly id: NativeId;
  readonly revisionId: NativeId;
  readonly auditId: NativeId;
  readonly createdAt: string;
  readonly actorType: AuditActorType;
  readonly actorId: string;
  readonly source: string;
  readonly requestId?: NativeId;
  readonly runId?: string;
  readonly reason?: string;
  readonly provenance: Readonly<Record<string, string>>;
}

export interface CreateAssetMutation {
  readonly asset: Asset;
  readonly revision: Revision<Asset, "asset">;
  readonly audit: AuditEvent<Asset, "asset", "asset.created">;
}

const STORAGE_KEY_PREFIX = "asset-";
const MIME_TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
const MIME_TYPE_PATTERN = new RegExp(`^${MIME_TOKEN}/${MIME_TOKEN}$`, "u");
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const AUDIT_ACTOR_TYPES: ReadonlySet<AuditActorType> = new Set([
  "user",
  "api-token",
  "importer",
  "system",
]);
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

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
    typeof input !== "object" ||
    input === null ||
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

  return Object.freeze({ originalFilename, mimeType });
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

export function validateAssetSha256(value: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new ValidationError("asset checksum is invalid");
  }
  return value;
}

export function prepareAssetCreation(
  command: CreateAssetCommand,
  dependencies: CreateAssetDependencies,
): PreparedAssetCreation {
  const metadata = normaliseAssetMetadata(command);
  const context = validateCreationContext(command);
  const timestamp = canonicalTimestamp(dependencies.now());
  const id = asNativeId(dependencies.newId());
  const revisionId = asNativeId(dependencies.newId());
  const auditId = asNativeId(dependencies.newId());
  const provenance = createProvenance(context);

  return Object.freeze({
    ...metadata,
    id,
    revisionId,
    auditId,
    createdAt: timestamp,
    ...context,
    provenance: Object.freeze(provenance),
  });
}

export function createAssetMutation(
  prepared: PreparedAssetCreation,
  receipt: AssetStageReceipt,
): CreateAssetMutation {
  validatePreparedAssetCreation(prepared);
  validateStageReceipt(prepared, receipt);
  const asset: Asset = Object.freeze({
    id: prepared.id,
    originalFilename: prepared.originalFilename,
    mimeType: prepared.mimeType,
    byteSize: receipt.byteSize,
    sha256: receipt.sha256,
    storageKey: receipt.storageKey,
    createdAt: prepared.createdAt,
    provenance: prepared.provenance,
  });
  const metadata = prepared.runId
    ? Object.freeze({ runId: prepared.runId })
    : undefined;

  return Object.freeze({
    asset,
    revision: Object.freeze({
      id: prepared.revisionId,
      entityType: "asset",
      entityId: asset.id,
      revisionNumber: 1,
      createdAt: asset.createdAt,
      snapshot: asset,
    }),
    audit: Object.freeze({
      id: prepared.auditId,
      timestamp: asset.createdAt,
      actorType: prepared.actorType,
      actorId: prepared.actorId,
      action: "asset.created",
      targetType: "asset",
      targetId: asset.id,
      source: prepared.source,
      ...(prepared.requestId ? { requestId: prepared.requestId } : {}),
      ...(prepared.reason ? { reason: prepared.reason } : {}),
      before: null,
      after: asset,
      ...(metadata ? { metadata } : {}),
    }),
  });
}

function validateStageReceipt(
  prepared: PreparedAssetCreation,
  receipt: AssetStageReceipt,
): void {
  if (typeof receipt !== "object" || receipt === null) {
    throw new ValidationError("asset stage receipt is invalid");
  }
  if (receipt.id !== prepared.id) {
    throw new ValidationError("asset stage receipt identity does not match");
  }
  if (
    receipt.originalFilename !== prepared.originalFilename ||
    receipt.mimeType !== prepared.mimeType
  ) {
    throw new ValidationError("asset stage receipt metadata does not match");
  }
  if (receipt.storageKey !== storageKeyForAsset(prepared.id)) {
    throw new ValidationError("asset stage receipt key does not match");
  }
  asAssetStorageKey(receipt.storageKey);
  validateAssetByteSize(receipt.byteSize, Number.MAX_SAFE_INTEGER);
  validateAssetSha256(receipt.sha256);
}

function validatePreparedAssetCreation(prepared: PreparedAssetCreation): void {
  if (typeof prepared !== "object" || prepared === null) {
    throw new ValidationError("prepared asset creation is invalid");
  }
  const metadata = normaliseAssetMetadata(prepared);
  if (
    metadata.originalFilename !== prepared.originalFilename ||
    metadata.mimeType !== prepared.mimeType
  ) {
    throw new ValidationError("prepared asset metadata is not canonical");
  }
  asNativeId(prepared.id);
  asNativeId(prepared.revisionId);
  asNativeId(prepared.auditId);
  if (canonicalTimestamp(new Date(prepared.createdAt)) !== prepared.createdAt) {
    throw new ValidationError("prepared asset timestamp is not canonical");
  }
  const context = validateCreationContext(prepared);
  if (!sameStringRecord(prepared.provenance, createProvenance(context))) {
    throw new ValidationError("prepared asset provenance is invalid");
  }
}

function createProvenance(context: {
  readonly source: string;
  readonly actorId: string;
  readonly requestId?: NativeId;
  readonly runId?: string;
}): Readonly<Record<string, string>> {
  const provenance: Record<string, string> = {
    source: context.source,
    actorId: context.actorId,
  };
  if (context.requestId) provenance.requestId = context.requestId;
  if (context.runId) provenance.runId = context.runId;
  return Object.freeze(provenance);
}

function sameStringRecord(
  actual: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>,
): boolean {
  const actualEntries = Object.entries(actual);
  const expectedEntries = Object.entries(expected);
  return (
    actualEntries.length === expectedEntries.length &&
    actualEntries.every(([key, value]) => expected[key] === value)
  );
}

function validateCreationContext(command: CreateAssetCommand): {
  readonly actorType: AuditActorType;
  readonly actorId: string;
  readonly source: string;
  readonly requestId?: NativeId;
  readonly runId?: string;
  readonly reason?: string;
} {
  if (!AUDIT_ACTOR_TYPES.has(command.actorType)) {
    throw new ValidationError("actor type is not supported");
  }
  const actorId = validateBoundedText(command.actorId, "actor ID", 255);
  const source = validateBoundedText(command.source, "source", 128);
  const requestId =
    command.requestId === undefined
      ? undefined
      : asNativeId(validateBoundedText(command.requestId, "request ID", 36));
  const runId =
    command.runId === undefined ? undefined : validateRunId(command.runId);
  const reason =
    command.reason === undefined
      ? undefined
      : validateBoundedText(command.reason, "reason", 500);

  return {
    actorType: command.actorType,
    actorId,
    source,
    ...(requestId ? { requestId } : {}),
    ...(runId ? { runId } : {}),
    ...(reason ? { reason } : {}),
  };
}

function validateBoundedText(
  value: string,
  name: string,
  maximum: number,
): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${name} must be a string`);
  }
  const normalised = value.trim();
  if (normalised.length === 0 || normalised.length > maximum) {
    throw new ValidationError(`${name} is invalid`);
  }
  return normalised;
}

function validateRunId(value: string): string {
  const normalised = validateBoundedText(value, "run ID", 128);
  if (!RUN_ID_PATTERN.test(normalised)) {
    throw new ValidationError("run ID is invalid");
  }
  return normalised;
}

function canonicalTimestamp(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ValidationError("asset timestamp is invalid");
  }
  return value.toISOString();
}

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
