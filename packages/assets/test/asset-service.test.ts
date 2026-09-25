import { createHash } from "node:crypto";

import { expect, test } from "vitest";

import type {
  AssetStageInput,
  AssetStore,
  AssetStoreReceipt,
  AssetStorageKey,
  StagedAsset,
} from "../src/asset-storage.ts";
import {
  AssetCompensationError,
  AssetService,
  AssetStorageIntegrityError,
} from "../src/asset-service.ts";
import { InMemoryAssetMetadataRepository } from "../../database/src/asset-metadata-repository.ts";
import { storageKeyForAsset } from "../../domain/src/asset.ts";
import { asNativeId } from "../../domain/src/ids.ts";

const assetId = "11111111-1111-4111-8111-111111111111";
const revisionId = "22222222-2222-4222-8222-222222222222";
const auditId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const otherAssetId = "55555555-5555-4555-8555-555555555555";
const encoded = new TextEncoder();

type StoreOptions = {
  readonly stageError?: Error;
  readonly verifyResult?: boolean;
  readonly discardError?: Error;
  readonly stageReceipt?: (input: AssetStageInput) => StagedAsset;
};

class RecordingAssetStore implements AssetStore {
  readonly stageInputs: AssetStageInput[] = [];
  readonly verifiedReceipts: AssetStoreReceipt[] = [];
  readonly discardedKeys: AssetStorageKey[] = [];
  readonly #stagedKeys = new Set<AssetStorageKey>();

  constructor(private readonly options: StoreOptions = {}) {}

  async stage(input: AssetStageInput): Promise<StagedAsset> {
    if (this.options.stageError) throw this.options.stageError;
    await Promise.resolve();
    this.stageInputs.push({ ...input, bytes: Uint8Array.from(input.bytes) });
    const staged =
      this.options.stageReceipt?.(input) ??
      ({
        id: input.id,
        originalFilename: input.originalFilename.trim(),
        mimeType: input.mimeType.trim().toLowerCase(),
        storageKey: storageKeyForAsset(input.id),
        byteSize: input.bytes.byteLength,
        sha256: sha256For(input.bytes),
      } satisfies StagedAsset);
    this.#stagedKeys.add(staged.storageKey);
    return staged;
  }

  async read(): Promise<Uint8Array> {
    throw new Error("read is not used by the asset service");
  }

  async verify(receipt: AssetStoreReceipt): Promise<boolean> {
    this.verifiedReceipts.push(receipt);
    return this.options.verifyResult ?? true;
  }

  async discard(storageKey: AssetStorageKey): Promise<void> {
    this.discardedKeys.push(storageKey);
    if (this.options.discardError) throw this.options.discardError;
    this.#stagedKeys.delete(storageKey);
  }

  hasStaged(storageKey: AssetStorageKey): boolean {
    return this.#stagedKeys.has(storageKey);
  }
}

function createService(
  assetStore: AssetStore,
  assetRepository = new InMemoryAssetMetadataRepository(),
): AssetService {
  const ids = [assetId, revisionId, auditId];
  return new AssetService({
    assetStore,
    assetRepository,
    newId: () => ids.shift() ?? "",
    now: () => new Date("2026-09-21T14:00:00.000Z"),
  });
}

function createInput(bytes: Uint8Array) {
  return {
    originalFilename: " evidence.pdf ",
    mimeType: " Application/PDF ",
    bytes,
    actorType: "user" as const,
    actorId: "user-1",
    source: "human-ui",
    requestId,
    runId: "asset-run-1",
    reason: "attach evidence",
  };
}

function sha256For(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

test("creates canonical metadata from an owned staged byte snapshot", async () => {
  const store = new RecordingAssetStore();
  const repository = new InMemoryAssetMetadataRepository();
  const service = createService(store, repository);
  const bytes = encoded.encode("original evidence bytes");
  const expectedBytes = Uint8Array.from(bytes);

  const created = service.create(createInput(bytes));
  bytes.fill(0);
  const asset = await created;

  expect(store.stageInputs).toHaveLength(1);
  expect(store.stageInputs[0]?.bytes).toEqual(expectedBytes);
  expect(store.verifiedReceipts).toHaveLength(1);
  expect(store.discardedKeys).toEqual([]);
  await expect(repository.getById(asset.id)).resolves.toEqual({
    asset,
    revisionNumber: 1,
  });
  expect(repository.revisionsFor(asset.id)[0]?.snapshot).not.toHaveProperty(
    "bytes",
  );
  expect(repository.auditFor(asset.id)[0]).toMatchObject({
    action: "asset.created",
    requestId,
    metadata: { runId: "asset-run-1" },
  });
});

test("compensates a staged asset when canonical persistence fails", async () => {
  const store = new RecordingAssetStore();
  const repository = new InMemoryAssetMetadataRepository({
    failAt: "before-audit",
  });
  const service = createService(store, repository);
  const expectedKey = storageKeyForAsset(asNativeId(assetId));

  await expect(
    service.create(createInput(encoded.encode("evidence bytes"))),
  ).rejects.toThrow("injected failure before audit");
  expect(store.discardedKeys).toEqual([expectedKey]);
  expect(store.hasStaged(expectedKey)).toBe(false);
  await expect(repository.getById(asNativeId(assetId))).resolves.toBeNull();
});

test("does not compensate a stage operation that never fulfilled", async () => {
  const stageError = new Error("stage failed");
  const store = new RecordingAssetStore({ stageError });
  const repository = new InMemoryAssetMetadataRepository();
  const service = createService(store, repository);

  await expect(
    service.create(createInput(encoded.encode("evidence bytes"))),
  ).rejects.toThrow(stageError);
  expect(store.discardedKeys).toEqual([]);
  await expect(repository.list(100)).resolves.toEqual([]);
});

test("compensates an unverifiable staged receipt before persistence", async () => {
  const store = new RecordingAssetStore({ verifyResult: false });
  const repository = new InMemoryAssetMetadataRepository();
  const service = createService(store, repository);
  const expectedKey = storageKeyForAsset(asNativeId(assetId));

  await expect(
    service.create(createInput(encoded.encode("evidence bytes"))),
  ).rejects.toBeInstanceOf(AssetStorageIntegrityError);
  expect(store.discardedKeys).toEqual([expectedKey]);
  await expect(repository.list(100)).resolves.toEqual([]);
});

test("never deletes an untrusted key from a malformed stage receipt", async () => {
  const untrustedKey = storageKeyForAsset(asNativeId(otherAssetId));
  const store = new RecordingAssetStore({
    stageReceipt: (input) => ({
      id: input.id,
      originalFilename: input.originalFilename.trim(),
      mimeType: input.mimeType.trim().toLowerCase(),
      storageKey: untrustedKey,
      byteSize: input.bytes.byteLength,
      sha256: sha256For(input.bytes),
    }),
  });
  const repository = new InMemoryAssetMetadataRepository();
  const service = createService(store, repository);
  const expectedKey = storageKeyForAsset(asNativeId(assetId));

  await expect(
    service.create(createInput(encoded.encode("evidence bytes"))),
  ).rejects.toThrow("asset stage receipt key does not match");
  expect(store.discardedKeys).toEqual([expectedKey]);
  expect(store.hasStaged(untrustedKey)).toBe(true);
  await expect(repository.list(100)).resolves.toEqual([]);
});

test.each([
  [
    "another native ID",
    (input: AssetStageInput): StagedAsset => ({
      id: asNativeId(otherAssetId),
      originalFilename: input.originalFilename.trim(),
      mimeType: input.mimeType.trim().toLowerCase(),
      storageKey: storageKeyForAsset(input.id),
      byteSize: input.bytes.byteLength,
      sha256: sha256For(input.bytes),
    }),
  ],
  [
    "different filename metadata",
    (input: AssetStageInput): StagedAsset => ({
      id: input.id,
      originalFilename: "different.pdf",
      mimeType: input.mimeType.trim().toLowerCase(),
      storageKey: storageKeyForAsset(input.id),
      byteSize: input.bytes.byteLength,
      sha256: sha256For(input.bytes),
    }),
  ],
  [
    "different MIME metadata",
    (input: AssetStageInput): StagedAsset => ({
      id: input.id,
      originalFilename: input.originalFilename.trim(),
      mimeType: "text/plain",
      storageKey: storageKeyForAsset(input.id),
      byteSize: input.bytes.byteLength,
      sha256: sha256For(input.bytes),
    }),
  ],
  [
    "another storage key",
    (input: AssetStageInput): StagedAsset => ({
      id: input.id,
      originalFilename: input.originalFilename.trim(),
      mimeType: input.mimeType.trim().toLowerCase(),
      storageKey: storageKeyForAsset(asNativeId(otherAssetId)),
      byteSize: input.bytes.byteLength,
      sha256: sha256For(input.bytes),
    }),
  ],
  [
    "an unsafe byte size",
    (input: AssetStageInput): StagedAsset => ({
      id: input.id,
      originalFilename: input.originalFilename.trim(),
      mimeType: input.mimeType.trim().toLowerCase(),
      storageKey: storageKeyForAsset(input.id),
      byteSize: -1,
      sha256: sha256For(input.bytes),
    }),
  ],
  [
    "a malformed checksum",
    (input: AssetStageInput): StagedAsset => ({
      id: input.id,
      originalFilename: input.originalFilename.trim(),
      mimeType: input.mimeType.trim().toLowerCase(),
      storageKey: storageKeyForAsset(input.id),
      byteSize: input.bytes.byteLength,
      sha256: "A".repeat(64),
    }),
  ],
] as const)(
  "does not verify or persist when a receipt has %s",
  async (_label, stageReceipt) => {
    const store = new RecordingAssetStore({ stageReceipt });
    const repository = new InMemoryAssetMetadataRepository();
    const service = createService(store, repository);
    const expectedKey = storageKeyForAsset(asNativeId(assetId));

    await expect(
      service.create(createInput(encoded.encode("evidence bytes"))),
    ).rejects.toThrow();
    expect(store.verifiedReceipts).toEqual([]);
    expect(store.discardedKeys).toEqual([expectedKey]);
    await expect(repository.list(100)).resolves.toEqual([]);
  },
);

test.each([
  [
    "a mismatched byte size",
    (input: AssetStageInput): StagedAsset => ({
      id: input.id,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      storageKey: storageKeyForAsset(input.id),
      byteSize: input.bytes.byteLength + 1,
      sha256: sha256For(input.bytes),
    }),
  ],
  [
    "a mismatched checksum",
    (input: AssetStageInput): StagedAsset => ({
      id: input.id,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      storageKey: storageKeyForAsset(input.id),
      byteSize: input.bytes.byteLength,
      sha256: "b".repeat(64),
    }),
  ],
])(
  "compensates %s before metadata persistence",
  async (_label, stageReceipt) => {
    const store = new RecordingAssetStore({ stageReceipt });
    const repository = new InMemoryAssetMetadataRepository();
    const service = createService(store, repository);
    const expectedKey = storageKeyForAsset(asNativeId(assetId));

    await expect(
      service.create(createInput(encoded.encode("evidence bytes"))),
    ).rejects.toBeInstanceOf(AssetStorageIntegrityError);
    expect(store.discardedKeys).toEqual([expectedKey]);
    await expect(repository.list(100)).resolves.toEqual([]);
  },
);

test("surfaces both the persistence and cleanup failures without personal metadata", async () => {
  const cleanupError = new Error("cleanup failed");
  const store = new RecordingAssetStore({ discardError: cleanupError });
  const repository = new InMemoryAssetMetadataRepository({
    failAt: "before-revision",
  });
  const service = createService(store, repository);
  const expectedKey = storageKeyForAsset(asNativeId(assetId));

  let failure: unknown;
  try {
    await service.create(createInput(encoded.encode("evidence bytes")));
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(AssetCompensationError);
  const compensation = failure as AssetCompensationError;
  expect(compensation.storageKey).toBe(expectedKey);
  expect(compensation.errors).toContain(cleanupError);
  expect(compensation.message).not.toContain("evidence.pdf");
  expect(compensation.message).not.toContain("evidence bytes");
  expect(store.hasStaged(expectedKey)).toBe(true);
  await expect(repository.list(100)).resolves.toEqual([]);
});

test("rejects a non-byte input before staging", async () => {
  const store = new RecordingAssetStore();
  const service = createService(store);

  await expect(
    service.create({
      ...createInput(encoded.encode("evidence bytes")),
      bytes: "not-bytes",
    } as never),
  ).rejects.toThrow("asset bytes must be a Uint8Array");
  expect(store.stageInputs).toEqual([]);
});
