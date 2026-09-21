import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import type * as FileSystemPromises from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test, vi } from "vitest";

import { asNativeId } from "../../domain/src/ids.ts";

const fault = vi.hoisted(() => ({
  replaceWithSymlink: undefined as string | undefined,
  growAfterStat: false,
  failTemporaryUnlink: false,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FileSystemPromises>();
  return {
    ...actual,
    lstat: async (path: string) => {
      const information = await actual.lstat(path);
      if (fault.replaceWithSymlink && basename(path).startsWith("asset-")) {
        const outsideTarget = fault.replaceWithSymlink;
        fault.replaceWithSymlink = undefined;
        await actual.rm(path, { force: true });
        await actual.symlink(outsideTarget, path, "file");
      } else if (fault.growAfterStat && basename(path).startsWith("asset-")) {
        fault.growAfterStat = false;
        await actual.appendFile(path, "growth");
      }
      return information;
    },
    unlink: async (path: string) => {
      if (
        fault.failTemporaryUnlink &&
        basename(path).startsWith(".pos-native-asset-")
      ) {
        fault.failTemporaryUnlink = false;
        throw Object.assign(new Error("injected temporary unlink failure"), {
          code: "EPERM",
        });
      }
      await actual.unlink(path);
    },
  };
});

const { FilesystemAssetStore } =
  await import("../src/filesystem-asset-store.ts");

const cleanupRoots: string[] = [];

afterEach(async () => {
  fault.replaceWithSymlink = undefined;
  fault.growAfterStat = false;
  fault.failTemporaryUnlink = false;
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
  const root = await mkdtemp(join(tmpdir(), "pos-native-asset-race-"));
  cleanupRoots.push(root);
  return root;
}

async function stagedFourByteAsset(root: string) {
  const store = await FilesystemAssetStore.create(root, { maxBytes: 4 });
  const staged = await store.stage({
    id: asNativeId("44444444-4444-4444-8444-444444444444"),
    originalFilename: "race.txt",
    mimeType: "text/plain",
    bytes: new TextEncoder().encode("safe"),
  });
  return { staged, store };
}

test("rejects a path replaced with a symlink after its initial status check", async () => {
  const root = await isolatedRoot();
  const outsideRoot = await isolatedRoot();
  const outsideFile = join(outsideRoot, "outside.txt");
  await writeFile(outsideFile, "outside");
  const { staged, store } = await stagedFourByteAsset(root);
  fault.replaceWithSymlink = outsideFile;

  await expect(store.read(staged.storageKey)).rejects.toThrow();
  expect(await readFile(outsideFile, "utf8")).toBe("outside");
});

test("rejects a file that grows beyond the limit after its initial status check", async () => {
  const root = await isolatedRoot();
  const { staged, store } = await stagedFourByteAsset(root);
  fault.growAfterStat = true;

  await expect(store.read(staged.storageKey)).rejects.toThrow();
});

test("returns a receipt when fallback cleanup removes a published temporary link", async () => {
  const root = await isolatedRoot();
  const store = await FilesystemAssetStore.create(root, { maxBytes: 4 });
  fault.failTemporaryUnlink = true;

  const staged = await store.stage({
    id: asNativeId("55555555-5555-4555-8555-555555555555"),
    originalFilename: "cleanup.txt",
    mimeType: "text/plain",
    bytes: new TextEncoder().encode("safe"),
  });

  expect(new TextDecoder().decode(await store.read(staged.storageKey))).toBe(
    "safe",
  );
  expect(await readdir(root)).toEqual([staged.storageKey]);
});
