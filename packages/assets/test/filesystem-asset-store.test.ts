import {
  lstat,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test } from "vitest";

import { asNativeId } from "../../domain/src/ids.ts";
import { asAssetStorageKey } from "../src/asset-storage.ts";
import { FilesystemAssetStore } from "../src/filesystem-asset-store.ts";

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
  const root = await mkdtemp(join(tmpdir(), "pos-native-assets-"));
  cleanupRoots.push(root);
  return root;
}

const firstAssetId = asNativeId("22222222-2222-4222-8222-222222222222");
const secondAssetId = asNativeId("33333333-3333-4333-8333-333333333333");

test("stages, reads, and verifies private bytes under an opaque key", async () => {
  const root = await isolatedRoot();
  const store = await FilesystemAssetStore.create(root, { maxBytes: 16 });
  const staged = await store.stage({
    id: firstAssetId,
    originalFilename: " evidence.txt ",
    mimeType: "Text/Plain",
    bytes: new TextEncoder().encode("private evidence"),
  });

  expect(staged).toEqual({
    id: firstAssetId,
    originalFilename: "evidence.txt",
    mimeType: "text/plain",
    storageKey: "asset-22222222-2222-4222-8222-222222222222",
    byteSize: 16,
    sha256: "f7711d1542c029371e0ad7159632c392465700aed13126774e9e8a9575b20078",
  });
  expect(new TextDecoder().decode(await store.read(staged.storageKey))).toBe(
    "private evidence",
  );
  expect(await store.verify(staged)).toBe(true);

  const stored = await lstat(join(root, staged.storageKey));
  expect(stored.isFile()).toBe(true);
  expect(stored.isSymbolicLink()).toBe(false);
});

test("refuses duplicate publication without replacing bytes or leaving a temporary file", async () => {
  const root = await isolatedRoot();
  const store = await FilesystemAssetStore.create(root, { maxBytes: 32 });
  const first = await store.stage({
    id: firstAssetId,
    originalFilename: "first.txt",
    mimeType: "text/plain",
    bytes: new TextEncoder().encode("first"),
  });

  await expect(
    store.stage({
      id: firstAssetId,
      originalFilename: "second.txt",
      mimeType: "text/plain",
      bytes: new TextEncoder().encode("second"),
    }),
  ).rejects.toThrow();

  expect(new TextDecoder().decode(await store.read(first.storageKey))).toBe(
    "first",
  );
  expect((await readdir(root)).sort()).toEqual([first.storageKey]);
});

test("rejects oversized input before creating a target or temporary file", async () => {
  const root = await isolatedRoot();
  const store = await FilesystemAssetStore.create(root, { maxBytes: 4 });

  await expect(
    store.stage({
      id: firstAssetId,
      originalFilename: "large.bin",
      mimeType: "application/octet-stream",
      bytes: new Uint8Array(5),
    }),
  ).rejects.toThrow();
  expect(await readdir(root)).toEqual([]);
});

test("detects bytes altered after staging", async () => {
  const root = await isolatedRoot();
  const store = await FilesystemAssetStore.create(root, { maxBytes: 32 });
  const staged = await store.stage({
    id: firstAssetId,
    originalFilename: "evidence.txt",
    mimeType: "text/plain",
    bytes: new TextEncoder().encode("original"),
  });

  await writeFile(join(root, staged.storageKey), "changed");

  expect(await store.verify(staged)).toBe(false);
});

test("rejects an unexpectedly oversized on-disk file before returning bytes", async () => {
  const root = await isolatedRoot();
  const store = await FilesystemAssetStore.create(root, { maxBytes: 4 });
  const key = asAssetStorageKey("asset-33333333-3333-4333-8333-333333333333");
  await writeFile(join(root, key), new Uint8Array(5));

  await expect(store.read(key)).rejects.toThrow();
});

test("refuses symbolic-link targets without reading or deleting outside bytes", async ({
  skip,
}) => {
  const root = await isolatedRoot();
  const outsideRoot = await isolatedRoot();
  const outsideFile = join(outsideRoot, "outside.txt");
  await writeFile(outsideFile, "outside evidence");
  const store = await FilesystemAssetStore.create(root);
  const key = asAssetStorageKey("asset-33333333-3333-4333-8333-333333333333");

  try {
    await symlink(outsideFile, join(root, key), "file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      skip("host does not permit test symbolic links");
      return;
    }
    throw error;
  }

  const receipt = {
    storageKey: key,
    byteSize: 16,
    sha256: "f7711d1542c029371e0ad7159632c392465700aed13126774e9e8a9575b20078",
  };
  await expect(store.read(key)).rejects.toThrow();
  await expect(store.verify(receipt)).rejects.toThrow();
  await expect(store.discard(key)).rejects.toThrow();
  expect(await readFile(outsideFile, "utf8")).toBe("outside evidence");
});

test("discard is an idempotent rollback for a staged regular file", async () => {
  const root = await isolatedRoot();
  const store = await FilesystemAssetStore.create(root);
  const staged = await store.stage({
    id: secondAssetId,
    originalFilename: "rollback.txt",
    mimeType: "text/plain",
    bytes: new TextEncoder().encode("rollback"),
  });

  await store.discard(staged.storageKey);
  await store.discard(staged.storageKey);

  expect(await readdir(root)).toEqual([]);
});
