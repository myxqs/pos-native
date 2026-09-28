import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import { FilesystemAssetStore } from "../../assets/src/filesystem-asset-store.ts";
import { asNativeId } from "../../domain/src/ids.ts";
import { asAssetStorageKey } from "../../domain/src/asset.ts";
import { sha256ForBytes } from "../src/backup-manifest.ts";
import { FilesystemAssetRestoreTarget } from "../src/asset-restore-target.ts";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

test("reports both a receipt mismatch and failed cleanup", async () => {
  const targetRoot = await root();
  const target = await FilesystemAssetRestoreTarget.create(targetRoot, 1024);
  const assetId = asNativeId("11111111-1111-4111-8111-111111111111");
  const differentId = asNativeId("22222222-2222-4222-8222-222222222222");
  const bytes = new TextEncoder().encode("restored bytes");
  vi.spyOn(FilesystemAssetStore.prototype, "discard").mockRejectedValueOnce(
    new Error("cleanup failed"),
  );

  const failure = await target
    .stage(
      {
        assetId,
        storageKey: asAssetStorageKey(`asset-${differentId}`),
        relativePath: `assets/asset-${differentId}`,
        byteSize: bytes.byteLength,
        sha256: sha256ForBytes(bytes),
      },
      bytes,
    )
    .catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure).toMatchObject({
    message: "restored asset receipt mismatch and cleanup failed",
    errors: [
      expect.objectContaining({
        message: "restored asset receipt does not match backup",
      }),
      expect.objectContaining({ message: "cleanup failed" }),
    ],
  });
});

async function root() {
  const value = await mkdtemp(join(tmpdir(), "nativepos-asset-restore-"));
  roots.push(value);
  return value;
}

test("refuses non-empty and symbolic-link asset restore roots", async ({
  skip,
}) => {
  const nonempty = await root();
  await writeFile(join(nonempty, "sentinel"), "keep");
  await expect(
    FilesystemAssetRestoreTarget.create(nonempty, 1024),
  ).rejects.toThrow("asset restore target must be empty");
  await expect(
    writeFile(join(nonempty, "sentinel"), "keep", { flag: "wx" }),
  ).rejects.toThrow();

  const outside = await root();
  const parent = await root();
  const link = join(parent, "linked-root");
  try {
    await symlink(outside, link, "junction");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      skip();
      return;
    }
    throw error;
  }
  await expect(FilesystemAssetRestoreTarget.create(link, 1024)).rejects.toThrow(
    "asset restore target must be a regular directory",
  );
});

test("stages, verifies, and discards only a manifest-declared asset", async () => {
  const targetRoot = await root();
  const target = await FilesystemAssetRestoreTarget.create(targetRoot, 1024);
  const assetId = asNativeId("11111111-1111-4111-8111-111111111111");
  const storageKey = asAssetStorageKey(`asset-${assetId}`);
  const bytes = new TextEncoder().encode("restored bytes");
  const asset = {
    assetId,
    storageKey,
    relativePath: `assets/${storageKey}`,
    byteSize: bytes.byteLength,
    sha256: sha256ForBytes(bytes),
  };

  await expect(target.isEmpty()).resolves.toBe(true);
  await target.stage(asset, bytes);
  await expect(target.verify(asset)).resolves.toBe(true);
  await expect(target.isEmpty()).resolves.toBe(false);
  await target.discard(asset);
  await expect(target.isEmpty()).resolves.toBe(true);
});

test("refuses to overwrite a file created after the empty-root check", async () => {
  const targetRoot = await root();
  const target = await FilesystemAssetRestoreTarget.create(targetRoot, 1024);
  const assetId = asNativeId("11111111-1111-4111-8111-111111111111");
  const storageKey = asAssetStorageKey(`asset-${assetId}`);
  const existing = new TextEncoder().encode("preserve me");
  const replacement = new TextEncoder().encode("replacement");
  await writeFile(join(targetRoot, storageKey), existing, { flag: "wx" });

  await expect(
    target.stage(
      {
        assetId,
        storageKey,
        relativePath: `assets/${storageKey}`,
        byteSize: replacement.byteLength,
        sha256: sha256ForBytes(replacement),
      },
      replacement,
    ),
  ).rejects.toThrow("asset storage target already exists");
  await expect(readFile(join(targetRoot, storageKey))).resolves.toEqual(
    Buffer.from(existing),
  );
  await expect(readdir(targetRoot)).resolves.toEqual([storageKey]);
});

test("refuses a symbolic-link asset target without changing its destination", async ({
  skip,
}) => {
  const targetRoot = await root();
  const outside = await root();
  const target = await FilesystemAssetRestoreTarget.create(targetRoot, 1024);
  const assetId = asNativeId("11111111-1111-4111-8111-111111111111");
  const storageKey = asAssetStorageKey(`asset-${assetId}`);
  const outsideFile = join(outside, "outside.bin");
  await writeFile(outsideFile, "preserve me", { flag: "wx" });
  try {
    await symlink(outsideFile, join(targetRoot, storageKey), "file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      skip();
      return;
    }
    throw error;
  }
  const replacement = new TextEncoder().encode("replacement");

  await expect(
    target.stage(
      {
        assetId,
        storageKey,
        relativePath: `assets/${storageKey}`,
        byteSize: replacement.byteLength,
        sha256: sha256ForBytes(replacement),
      },
      replacement,
    ),
  ).rejects.toThrow("asset storage target already exists");
  await expect(readFile(outsideFile, "utf8")).resolves.toBe("preserve me");
});
