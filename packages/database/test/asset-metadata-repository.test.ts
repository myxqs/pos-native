import { expect, test } from "vitest";

import {
  createAssetMutation,
  prepareAssetCreation,
  type AssetStageReceipt,
  type AssetStorageKey,
  type CreateAssetMutation,
} from "../../domain/src/asset.ts";
import { InMemoryAssetMetadataRepository } from "../src/asset-metadata-repository.ts";

const createdAt = "2026-09-21T13:00:00.000Z";
const assetId = "11111111-1111-4111-8111-111111111111";
const revisionId = "22222222-2222-4222-8222-222222222222";
const auditId = "33333333-3333-4333-8333-333333333333";
const secondAssetId = "44444444-4444-4444-8444-444444444444";
const secondRevisionId = "55555555-5555-4555-8555-555555555555";
const secondAuditId = "66666666-6666-4666-8666-666666666666";

function assetCreation(
  ids = [assetId, revisionId, auditId],
): CreateAssetMutation {
  const generated = [...ids];
  const prepared = prepareAssetCreation(
    {
      originalFilename: "evidence.pdf",
      mimeType: "application/pdf",
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    {
      newId: () => generated.shift() ?? "",
      now: () => new Date(createdAt),
    },
  );
  return createAssetMutation(prepared, {
    id: prepared.id,
    originalFilename: prepared.originalFilename,
    mimeType: prepared.mimeType,
    storageKey: `asset-${prepared.id}` as AssetStorageKey,
    byteSize: 12,
    sha256: "a".repeat(64),
  } satisfies AssetStageReceipt);
}

function withStorageKey(
  mutation: CreateAssetMutation,
  storageKey: AssetStorageKey,
): CreateAssetMutation {
  const asset = Object.freeze({ ...mutation.asset, storageKey });
  return Object.freeze({
    asset,
    revision: Object.freeze({ ...mutation.revision, snapshot: asset }),
    audit: Object.freeze({ ...mutation.audit, after: asset }),
  });
}

test("persists asset metadata with revision and audit history as one mutation", async () => {
  const repository = new InMemoryAssetMetadataRepository();
  const mutation = assetCreation();

  await expect(repository.create(mutation)).resolves.toEqual(mutation.asset);
  await expect(repository.getById(mutation.asset.id)).resolves.toEqual({
    asset: mutation.asset,
    revisionNumber: 1,
  });
  await expect(repository.list(100)).resolves.toEqual([mutation.asset]);
  expect(repository.revisionsFor(mutation.asset.id)).toEqual([
    mutation.revision,
  ]);
  expect(repository.auditFor(mutation.asset.id)).toEqual([mutation.audit]);
});

test("lists assets in creation-time and native-ID order", async () => {
  const repository = new InMemoryAssetMetadataRepository();
  const first = assetCreation();
  const second = assetCreation([
    secondAssetId,
    secondRevisionId,
    secondAuditId,
  ]);
  await repository.create(second);
  await repository.create(first);

  await expect(repository.list(100)).resolves.toEqual([
    first.asset,
    second.asset,
  ]);
});

test("bounds an ordered asset metadata list at the repository", async () => {
  const repository = new InMemoryAssetMetadataRepository();
  const first = assetCreation();
  const second = assetCreation([
    secondAssetId,
    secondRevisionId,
    secondAuditId,
  ]);
  await repository.create(second);
  await repository.create(first);

  await expect(repository.list(1)).resolves.toEqual([first.asset]);
});

test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  "rejects invalid asset list limit %s",
  async (limit) => {
    const repository = new InMemoryAssetMetadataRepository();

    await expect(repository.list(limit)).rejects.toThrow(
      "asset list limit must be a positive safe integer",
    );
  },
);

test.each(["before-revision", "before-audit"] as const)(
  "rolls back all asset state when persistence fails at %s",
  async (failAt) => {
    const repository = new InMemoryAssetMetadataRepository({ failAt });
    const mutation = assetCreation();

    await expect(repository.create(mutation)).rejects.toThrow(
      `injected failure ${failAt.replace("-", " ")}`,
    );
    await expect(repository.getById(mutation.asset.id)).resolves.toBeNull();
    await expect(repository.list(100)).resolves.toEqual([]);
    expect(repository.revisionsFor(mutation.asset.id)).toEqual([]);
    expect(repository.auditFor(mutation.asset.id)).toEqual([]);
  },
);

test("rejects a duplicate native asset identity without replacing its history", async () => {
  const repository = new InMemoryAssetMetadataRepository();
  const mutation = assetCreation();
  await repository.create(mutation);

  await expect(repository.create(mutation)).rejects.toThrow(
    "asset already exists",
  );
  await expect(repository.getById(mutation.asset.id)).resolves.toEqual({
    asset: mutation.asset,
    revisionNumber: 1,
  });
  expect(repository.revisionsFor(mutation.asset.id)).toEqual([
    mutation.revision,
  ]);
  expect(repository.auditFor(mutation.asset.id)).toEqual([mutation.audit]);
});

test("rejects a duplicate opaque storage key without replacing either asset", async () => {
  const repository = new InMemoryAssetMetadataRepository();
  const first = assetCreation();
  const second = withStorageKey(
    assetCreation([secondAssetId, secondRevisionId, secondAuditId]),
    first.asset.storageKey,
  );
  await repository.create(first);

  await expect(repository.create(second)).rejects.toThrow(
    "asset storage key already exists",
  );
  await expect(repository.getById(first.asset.id)).resolves.toEqual({
    asset: first.asset,
    revisionNumber: 1,
  });
  await expect(repository.getById(second.asset.id)).resolves.toBeNull();
  expect(repository.revisionsFor(first.asset.id)).toEqual([first.revision]);
  expect(repository.auditFor(first.asset.id)).toEqual([first.audit]);
});
