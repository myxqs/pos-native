import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";

import {
  asAssetStorageKey,
  type AssetStorageKey,
} from "../../assets/src/asset-storage.ts";
import { asNativeId } from "../../domain/src/ids.ts";
import { sha256ForBytes } from "../src/backup-manifest.ts";
import {
  createFilesystemBackup,
  listFilesystemBackups,
  restoreFilesystemBackup,
  type BackupOperationOptions,
  type BackupSource,
  verifyFilesystemBackup,
} from "../src/filesystem-backup.ts";

const encoder = new TextEncoder();
const backupId = asNativeId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const firstAssetId = asNativeId("11111111-1111-4111-8111-111111111111");
const secondAssetId = asNativeId("22222222-2222-4222-8222-222222222222");
const firstKey = asAssetStorageKey(
  "asset-11111111-1111-4111-8111-111111111111",
);
const secondKey = asAssetStorageKey(
  "asset-22222222-2222-4222-8222-222222222222",
);
const databaseBytes = encoder.encode("synthetic database dump");
const assetBytes = new Map([
  [firstKey, encoder.encode("first asset")],
  [secondKey, encoder.encode("second asset")],
]);
const options: BackupOperationOptions = {
  backupId,
  createdAt: new Date("2026-09-21T00:00:00.000Z"),
  maxArtifactBytes: 1024,
};
const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupRoots.splice(0).map((root) =>
      rm(root, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

async function isolatedRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pos-native-backup-"));
  cleanupRoots.push(root);
  return root;
}

function fixtureSource(
  readAssetOverride?: (storageKey: AssetStorageKey) => Uint8Array,
): BackupSource {
  const assets = [
    {
      assetId: secondAssetId,
      storageKey: secondKey,
      byteSize: assetBytes.get(secondKey)?.byteLength ?? 0,
      sha256: sha256ForBytes(assetBytes.get(secondKey) ?? new Uint8Array()),
    },
    {
      assetId: firstAssetId,
      storageKey: firstKey,
      byteSize: assetBytes.get(firstKey)?.byteLength ?? 0,
      sha256: sha256ForBytes(assetBytes.get(firstKey) ?? new Uint8Array()),
    },
  ];

  return {
    metadata: {
      schemaVersion: "0004",
      applicationVersion: "0.1.0",
      databaseDumpFormat: "postgresql-custom-v1",
      assetStoreFormat: "filesystem-v1",
    },
    async readDatabaseDump() {
      return Uint8Array.from(databaseBytes);
    },
    async listAssets() {
      return assets;
    },
    async readAsset(asset) {
      const bytes =
        readAssetOverride?.(asset.storageKey) ??
        assetBytes.get(asset.storageKey);
      if (bytes === undefined) throw new Error("fixture asset was not found");
      return Uint8Array.from(bytes);
    },
  };
}

function backupDirectory(root: string): string {
  return join(root, `backup-${backupId}`);
}

test("creates, lists, verifies, and restores a synthetic backup into a clean root", async () => {
  const root = await isolatedRoot();
  const restoreRoot = await isolatedRoot();
  const created = await createFilesystemBackup(root, fixtureSource(), options);

  expect(await listFilesystemBackups(root)).toEqual([backupId]);
  expect(await verifyFilesystemBackup(root, backupId, options)).toEqual(
    created.manifest,
  );
  expect(
    await readFile(join(created.directory, "database", "canonical.dump")),
  ).toEqual(Buffer.from(databaseBytes));

  const restored = await restoreFilesystemBackup(
    root,
    backupId,
    restoreRoot,
    options,
  );
  expect(
    await readFile(join(restored.directory, "database", "canonical.dump")),
  ).toEqual(Buffer.from(databaseBytes));
  expect(
    await verifyFilesystemBackup(restored.backupRoot, backupId, options),
  ).toEqual(created.manifest);
});

test("refuses a duplicate backup ID without changing the original artifacts", async () => {
  const root = await isolatedRoot();
  const created = await createFilesystemBackup(root, fixtureSource(), options);
  const originalManifest = await readFile(
    join(created.directory, "manifest.json"),
  );

  await expect(
    createFilesystemBackup(root, fixtureSource(), options),
  ).rejects.toThrow();

  expect(await readFile(join(created.directory, "manifest.json"))).toEqual(
    originalManifest,
  );
  expect(await listFilesystemBackups(root)).toEqual([backupId]);
});

test("refuses an existing restore backup directory without changing its sentinel", async () => {
  const sourceRoot = await isolatedRoot();
  const targetRoot = await isolatedRoot();
  await createFilesystemBackup(sourceRoot, fixtureSource(), options);
  const targetDirectory = backupDirectory(targetRoot);
  await mkdir(targetDirectory);
  await writeFile(join(targetDirectory, "sentinel.txt"), "keep me");

  await expect(
    restoreFilesystemBackup(sourceRoot, backupId, targetRoot, options),
  ).rejects.toThrow();

  expect(await readFile(join(targetDirectory, "sentinel.txt"), "utf8")).toBe(
    "keep me",
  );
});

test("rejects a tampered artifact before creating a restore output", async () => {
  const sourceRoot = await isolatedRoot();
  const targetRoot = await isolatedRoot();
  const created = await createFilesystemBackup(
    sourceRoot,
    fixtureSource(),
    options,
  );
  await writeFile(join(created.directory, "assets", firstKey), "altered");

  await expect(
    verifyFilesystemBackup(sourceRoot, backupId, options),
  ).rejects.toThrow();
  await expect(
    restoreFilesystemBackup(sourceRoot, backupId, targetRoot, options),
  ).rejects.toThrow();
  await expect(lstat(backupDirectory(targetRoot))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

test("rejects a source receipt mismatch without publishing a backup", async () => {
  const root = await isolatedRoot();

  await expect(
    createFilesystemBackup(
      root,
      fixtureSource((storageKey) =>
        storageKey === firstKey
          ? encoder.encode("altered")
          : (assetBytes.get(storageKey) ?? new Uint8Array()),
      ),
      options,
    ),
  ).rejects.toThrow();

  expect(await listFilesystemBackups(root)).toEqual([]);
  expect(await readdir(root)).toEqual([]);
});

test("does not list a partial backup and refuses to verify it", async () => {
  const root = await isolatedRoot();
  await mkdir(backupDirectory(root));

  expect(await listFilesystemBackups(root)).toEqual([]);
  await expect(
    verifyFilesystemBackup(root, backupId, options),
  ).rejects.toThrow();
});

test("refuses a symbolic-link artifact without reading outside bytes", async ({
  skip,
}) => {
  const sourceRoot = await isolatedRoot();
  const outsideRoot = await isolatedRoot();
  const created = await createFilesystemBackup(
    sourceRoot,
    fixtureSource(),
    options,
  );
  const outsideFile = join(outsideRoot, "outside.txt");
  await writeFile(outsideFile, "outside evidence");
  const artifactPath = join(created.directory, "assets", firstKey);
  await unlink(artifactPath);

  try {
    await symlink(outsideFile, artifactPath, "file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      skip("host does not permit test symbolic links");
      return;
    }
    throw error;
  }

  await expect(
    verifyFilesystemBackup(sourceRoot, backupId, options),
  ).rejects.toThrow();
  expect(await readFile(outsideFile, "utf8")).toBe("outside evidence");
});

test("requires a safe explicit artifact cap before changing a backup or restore target", async () => {
  const root = await isolatedRoot();
  const targetRoot = await isolatedRoot();
  await expect(
    createFilesystemBackup(root, fixtureSource(), {
      ...options,
      maxArtifactBytes: 0,
    }),
  ).rejects.toThrow();
  await expect(
    createFilesystemBackup(root, fixtureSource(), {
      ...options,
      maxArtifactBytes: 1,
    }),
  ).rejects.toThrow();
  expect(await readdir(root)).toEqual([]);

  await createFilesystemBackup(root, fixtureSource(), options);
  await mkdir(backupDirectory(targetRoot));
  await writeFile(join(backupDirectory(targetRoot), "sentinel.txt"), "keep me");
  await expect(
    restoreFilesystemBackup(root, backupId, targetRoot, {
      ...options,
      maxArtifactBytes: 0,
    }),
  ).rejects.toThrow();
  expect(
    await readFile(join(backupDirectory(targetRoot), "sentinel.txt"), "utf8"),
  ).toBe("keep me");
});
