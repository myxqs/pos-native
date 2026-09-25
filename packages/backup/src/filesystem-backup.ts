import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  asNativeId,
  type NativeId,
  ValidationError,
} from "../../domain/src/ids.ts";
import {
  assetBackupRelativePath,
  createBackupManifest,
  DATABASE_ARTIFACT_PATH,
  parseBackupManifest,
  type BackupArtifactDescriptor,
  type BackupManifest,
  type BackupSourceAsset,
  type BackupSourceMetadata,
  serializeBackupManifest,
  sha256ForBytes,
} from "./backup-manifest.ts";

const MANIFEST_PATH = "manifest.json";
const MAX_MANIFEST_BYTES = 1024 * 1024;
const BACKUP_DIRECTORY_PREFIX = "backup-";

export interface BackupSource {
  readonly metadata: BackupSourceMetadata;
  readDatabaseDump(): Promise<Uint8Array>;
  listAssets(): Promise<readonly BackupSourceAsset[]>;
  readAsset(asset: BackupSourceAsset): Promise<Uint8Array>;
}

export interface BackupOperationOptions {
  readonly backupId?: NativeId;
  readonly createdAt?: Date;
  readonly maxArtifactBytes: number;
}

export interface FilesystemBackupLocation {
  readonly backupId: NativeId;
  readonly backupRoot: string;
  readonly directory: string;
  readonly manifest: BackupManifest;
}

export interface VerifiedDatabaseDump {
  readonly manifest: BackupManifest;
  readonly bytes: Uint8Array;
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function isRegularFile(information: {
  isFile(): boolean;
  isSymbolicLink(): boolean;
}): boolean {
  return information.isFile() && !information.isSymbolicLink();
}

function isRegularDirectory(information: {
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}): boolean {
  return information.isDirectory() && !information.isSymbolicLink();
}

function isSameFile(
  left: { readonly dev: number; readonly ino: number },
  right: { readonly dev: number; readonly ino: number },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function requireMaxArtifactBytes(options: BackupOperationOptions): number {
  const maxArtifactBytes = options.maxArtifactBytes;
  if (!Number.isSafeInteger(maxArtifactBytes) || maxArtifactBytes <= 0) {
    throw new ValidationError(
      "backup artifact limit must be a positive safe integer",
    );
  }

  return maxArtifactBytes;
}

function requireBoundedByteSize(byteSize: number, maxBytes: number): void {
  if (!Number.isSafeInteger(byteSize) || byteSize < 0 || byteSize > maxBytes) {
    throw new ValidationError("backup artifact exceeds the configured limit");
  }
}

function backupDirectoryName(backupId: NativeId): string {
  return `${BACKUP_DIRECTORY_PREFIX}${asNativeId(backupId)}`;
}

function requireContained(root: string, candidate: string): void {
  const candidateRelative = relative(root, candidate);
  if (
    candidateRelative.length === 0 ||
    candidateRelative === ".." ||
    candidateRelative.startsWith(`..${sep}`) ||
    isAbsolute(candidateRelative)
  ) {
    throw new ValidationError("backup path escapes its configured root");
  }
}

function pathForRelative(root: string, relativePath: string): string {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    relativePath.includes("\\") ||
    isAbsolute(relativePath) ||
    /^[A-Za-z]:/u.test(relativePath) ||
    relativePath
      .split("/")
      .some(
        (segment) =>
          segment.length === 0 || segment === "." || segment === "..",
      )
  ) {
    throw new ValidationError("backup artifact path is invalid");
  }

  const candidate = resolve(root, ...relativePath.split("/"));
  requireContained(root, candidate);
  return candidate;
}

function backupDirectoryPath(root: string, backupId: NativeId): string {
  const candidate = resolve(root, backupDirectoryName(backupId));
  requireContained(root, candidate);
  return candidate;
}

async function canonicalBackupRoot(
  configuredRoot: string,
  createIfMissing: boolean,
): Promise<string> {
  if (
    typeof configuredRoot !== "string" ||
    configuredRoot.trim().length === 0
  ) {
    throw new ValidationError("backup root is required");
  }

  const resolvedRoot = resolve(configuredRoot);
  if (createIfMissing) {
    await mkdir(resolvedRoot, { recursive: true });
  }

  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(resolvedRoot);
  } catch (error) {
    if (isMissingFile(error)) {
      throw new ValidationError("backup root does not exist");
    }
    throw error;
  }
  const information = await lstat(canonicalRoot);
  if (!isRegularDirectory(information)) {
    throw new ValidationError("backup root must be a directory");
  }

  return canonicalRoot;
}

async function requireBackupDirectory(
  root: string,
  backupId: NativeId,
): Promise<string> {
  const directory = backupDirectoryPath(root, backupId);
  let information;
  try {
    information = await lstat(directory);
  } catch (error) {
    if (isMissingFile(error)) {
      throw new ValidationError("backup directory does not exist");
    }
    throw error;
  }
  if (!isRegularDirectory(information)) {
    throw new ValidationError("backup directory must be a regular directory");
  }

  return directory;
}

async function createBackupDirectory(
  root: string,
  backupId: NativeId,
): Promise<string> {
  const directory = backupDirectoryPath(root, backupId);
  try {
    await mkdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ValidationError("backup directory already exists");
    }
    throw error;
  }

  return directory;
}

async function createBackupLayout(directory: string): Promise<void> {
  await mkdir(pathForRelative(directory, "database"));
  await mkdir(pathForRelative(directory, "assets"));
}

function snapshotBytes(value: Uint8Array, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new ValidationError(`${label} must be bytes`);
  }

  return Uint8Array.from(value);
}

async function writeNewFile(
  root: string,
  relativePath: string,
  bytes: Uint8Array,
): Promise<void> {
  const destination = pathForRelative(root, relativePath);
  const handle = await open(destination, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readBounded(
  handle: FileHandle,
  maxBytes: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let position = 0;

  while (true) {
    const bufferLength =
      totalBytes === maxBytes ? 1 : Math.min(64 * 1024, maxBytes - totalBytes);
    const buffer = Buffer.allocUnsafe(bufferLength);
    const { bytesRead } = await handle.read(
      buffer,
      0,
      buffer.byteLength,
      position,
    );
    if (bytesRead === 0) break;
    if (totalBytes === maxBytes || totalBytes + bytesRead > maxBytes) {
      throw new ValidationError("backup artifact exceeds the configured limit");
    }
    totalBytes += bytesRead;
    chunks.push(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }

  return Buffer.concat(chunks, totalBytes);
}

async function readRegularFile(
  root: string,
  relativePath: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const candidate = pathForRelative(root, relativePath);
  let beforeOpen;
  try {
    beforeOpen = await lstat(candidate);
  } catch (error) {
    if (isMissingFile(error)) {
      throw new ValidationError("backup artifact is missing");
    }
    throw error;
  }
  if (!isRegularFile(beforeOpen)) {
    throw new ValidationError("backup artifact must be a regular file");
  }

  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await open(candidate, constants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat();
    const afterOpen = await lstat(candidate);
    if (
      !isRegularFile(opened) ||
      !isRegularFile(afterOpen) ||
      !isSameFile(beforeOpen, opened) ||
      !isSameFile(opened, afterOpen)
    ) {
      throw new ValidationError("backup artifact changed during read");
    }
    requireBoundedByteSize(opened.size, maxBytes);
    const bytes = await readBounded(handle, maxBytes);
    const afterRead = await handle.stat();
    if (
      !isRegularFile(afterRead) ||
      !isSameFile(opened, afterRead) ||
      afterRead.size !== opened.size
    ) {
      throw new ValidationError("backup artifact changed during read");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function readManifest(directory: string): Promise<BackupManifest> {
  const manifestBytes = await readRegularFile(
    directory,
    MANIFEST_PATH,
    MAX_MANIFEST_BYTES,
  );
  return parseBackupManifest(new TextDecoder().decode(manifestBytes));
}

async function readVerifiedArtifact(
  directory: string,
  artifact: BackupArtifactDescriptor,
  maxArtifactBytes: number,
): Promise<Uint8Array> {
  const bytes = await readRegularFile(
    directory,
    artifact.relativePath,
    maxArtifactBytes,
  );
  if (
    bytes.byteLength !== artifact.byteSize ||
    sha256ForBytes(bytes) !== artifact.sha256
  ) {
    throw new ValidationError("backup artifact integrity check failed");
  }

  return bytes;
}

function sourceAssetDescriptors(
  assets: readonly BackupSourceAsset[],
): readonly {
  readonly assetId: NativeId;
  readonly storageKey: BackupSourceAsset["storageKey"];
  readonly relativePath: string;
  readonly byteSize: number;
  readonly sha256: string;
}[] {
  if (!Array.isArray(assets)) {
    throw new ValidationError("backup source assets must be an array");
  }

  return assets.map((asset) => ({
    assetId: asset.assetId,
    storageKey: asset.storageKey,
    relativePath: assetBackupRelativePath(asset.storageKey),
    byteSize: asset.byteSize,
    sha256: asset.sha256,
  }));
}

function operationCreatedAt(options: BackupOperationOptions): string {
  const createdAt = options.createdAt ?? new Date();
  if (!(createdAt instanceof Date) || Number.isNaN(createdAt.valueOf())) {
    throw new ValidationError("backup creation time is invalid");
  }

  return createdAt.toISOString();
}

function operationBackupId(options: BackupOperationOptions): NativeId {
  return asNativeId(options.backupId ?? randomUUID());
}

async function cleanupCreatedDirectory(directory: string): Promise<void> {
  let information;
  try {
    information = await lstat(directory);
  } catch (error) {
    if (isMissingFile(error)) return;
    throw error;
  }
  if (!isRegularDirectory(information)) {
    throw new ValidationError(
      "created backup directory changed during cleanup",
    );
  }
  await rm(directory, { force: true, recursive: true });
}

async function rethrowAfterCleanup(
  error: unknown,
  directory: string,
): Promise<never> {
  try {
    await cleanupCreatedDirectory(directory);
  } catch (cleanupError) {
    throw new AggregateError(
      [error, cleanupError],
      "backup operation and cleanup failed",
      { cause: cleanupError },
    );
  }
  throw error;
}

export async function createFilesystemBackup(
  configuredRoot: string,
  source: BackupSource,
  options: BackupOperationOptions,
): Promise<FilesystemBackupLocation> {
  const maxArtifactBytes = requireMaxArtifactBytes(options);
  const backupId = operationBackupId(options);
  const createdAt = operationCreatedAt(options);
  const databaseBytes = snapshotBytes(
    await source.readDatabaseDump(),
    "database dump",
  );
  requireBoundedByteSize(databaseBytes.byteLength, maxArtifactBytes);
  const sourceAssets = await source.listAssets();
  const manifest = createBackupManifest({
    backupId,
    createdAt,
    source: source.metadata,
    database: {
      relativePath: DATABASE_ARTIFACT_PATH,
      byteSize: databaseBytes.byteLength,
      sha256: sha256ForBytes(databaseBytes),
    },
    assets: sourceAssetDescriptors(sourceAssets),
  });
  const preparedAssets = await Promise.all(
    manifest.assets.map(async (asset) => {
      const bytes = snapshotBytes(
        await source.readAsset(asset),
        "backup asset",
      );
      requireBoundedByteSize(bytes.byteLength, maxArtifactBytes);
      if (
        bytes.byteLength !== asset.byteSize ||
        sha256ForBytes(bytes) !== asset.sha256
      ) {
        throw new ValidationError(
          "backup source asset receipt does not match bytes",
        );
      }
      return { asset, bytes };
    }),
  );

  const backupRoot = await canonicalBackupRoot(configuredRoot, true);
  const directory = await createBackupDirectory(backupRoot, backupId);
  try {
    await createBackupLayout(directory);
    await writeNewFile(directory, DATABASE_ARTIFACT_PATH, databaseBytes);
    for (const prepared of preparedAssets) {
      await writeNewFile(
        directory,
        prepared.asset.relativePath,
        prepared.bytes,
      );
    }
    await writeNewFile(
      directory,
      MANIFEST_PATH,
      new TextEncoder().encode(serializeBackupManifest(manifest)),
    );
    const verifiedManifest = await verifyFilesystemBackup(
      backupRoot,
      backupId,
      options,
    );
    return { backupId, backupRoot, directory, manifest: verifiedManifest };
  } catch (error) {
    return rethrowAfterCleanup(error, directory);
  }
}

export async function listFilesystemBackups(
  configuredRoot: string,
): Promise<readonly NativeId[]> {
  const backupRoot = await canonicalBackupRoot(configuredRoot, false);
  const entries = await readdir(backupRoot, { withFileTypes: true });
  const backupIds: NativeId[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (!entry.name.startsWith(BACKUP_DIRECTORY_PREFIX)) continue;
    let backupId: NativeId;
    try {
      backupId = asNativeId(entry.name.slice(BACKUP_DIRECTORY_PREFIX.length));
    } catch {
      continue;
    }
    try {
      const manifestInformation = await lstat(
        pathForRelative(
          backupDirectoryPath(backupRoot, backupId),
          MANIFEST_PATH,
        ),
      );
      if (isRegularFile(manifestInformation)) {
        backupIds.push(backupId);
      }
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }

  return backupIds.sort((left, right) => left.localeCompare(right));
}

export async function verifyFilesystemBackup(
  configuredRoot: string,
  requestedBackupId: NativeId,
  options: BackupOperationOptions,
): Promise<BackupManifest> {
  const maxArtifactBytes = requireMaxArtifactBytes(options);
  const backupId = asNativeId(requestedBackupId);
  const backupRoot = await canonicalBackupRoot(configuredRoot, false);
  const directory = await requireBackupDirectory(backupRoot, backupId);
  const manifest = await readManifest(directory);
  if (manifest.backupId !== backupId) {
    throw new ValidationError(
      "backup manifest ID does not match its directory",
    );
  }

  await readVerifiedArtifact(directory, manifest.database, maxArtifactBytes);
  for (const asset of manifest.assets) {
    await readVerifiedArtifact(directory, asset, maxArtifactBytes);
  }

  return manifest;
}

export async function readVerifiedDatabaseDump(
  configuredRoot: string,
  requestedBackupId: NativeId,
  options: BackupOperationOptions,
): Promise<VerifiedDatabaseDump> {
  const maxArtifactBytes = requireMaxArtifactBytes(options);
  const backupId = asNativeId(requestedBackupId);
  const manifest = await verifyFilesystemBackup(
    configuredRoot,
    backupId,
    options,
  );
  const backupRoot = await canonicalBackupRoot(configuredRoot, false);
  const directory = await requireBackupDirectory(backupRoot, backupId);
  const bytes = await readVerifiedArtifact(
    directory,
    manifest.database,
    maxArtifactBytes,
  );

  return { manifest, bytes };
}

export async function restoreFilesystemBackup(
  sourceRoot: string,
  requestedBackupId: NativeId,
  targetRoot: string,
  options: BackupOperationOptions,
): Promise<FilesystemBackupLocation> {
  const maxArtifactBytes = requireMaxArtifactBytes(options);
  const backupId = asNativeId(requestedBackupId);
  const manifest = await verifyFilesystemBackup(sourceRoot, backupId, options);
  const sourceBackupRoot = await canonicalBackupRoot(sourceRoot, false);
  const sourceDirectory = await requireBackupDirectory(
    sourceBackupRoot,
    backupId,
  );
  const targetBackupRoot = await canonicalBackupRoot(targetRoot, false);
  const targetDirectory = await createBackupDirectory(
    targetBackupRoot,
    backupId,
  );

  try {
    await createBackupLayout(targetDirectory);
    await writeNewFile(
      targetDirectory,
      manifest.database.relativePath,
      await readVerifiedArtifact(
        sourceDirectory,
        manifest.database,
        maxArtifactBytes,
      ),
    );
    for (const asset of manifest.assets) {
      await writeNewFile(
        targetDirectory,
        asset.relativePath,
        await readVerifiedArtifact(sourceDirectory, asset, maxArtifactBytes),
      );
    }
    await writeNewFile(
      targetDirectory,
      MANIFEST_PATH,
      new TextEncoder().encode(serializeBackupManifest(manifest)),
    );
    const verifiedManifest = await verifyFilesystemBackup(
      targetBackupRoot,
      backupId,
      options,
    );
    return {
      backupId,
      backupRoot: targetBackupRoot,
      directory: targetDirectory,
      manifest: verifiedManifest,
    };
  } catch (error) {
    return rethrowAfterCleanup(error, targetDirectory);
  }
}
