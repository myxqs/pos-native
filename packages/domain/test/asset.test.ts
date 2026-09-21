import { expect, test } from "vitest";

import {
  createAssetMutation,
  prepareAssetCreation,
  type AssetStageReceipt,
  type AssetStorageKey,
} from "../src/asset.ts";
import { ValidationError } from "../src/ids.ts";

const assetId = "11111111-1111-4111-8111-111111111111";
const revisionId = "22222222-2222-4222-8222-222222222222";
const auditId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const createdAt = "2026-09-21T12:00:00.000Z";
const sha256 = "a".repeat(64);

function prepare() {
  const ids = [assetId, revisionId, auditId];
  return prepareAssetCreation(
    {
      originalFilename: " Report.pdf ",
      mimeType: " Application/PDF ",
      actorType: "user",
      actorId: " user-1 ",
      source: " human-ui ",
      requestId,
      runId: "asset-run-1",
      reason: "attach evidence",
    },
    {
      newId: () => ids.shift() ?? "",
      now: () => new Date(createdAt),
    },
  );
}

function matchingReceipt(): AssetStageReceipt {
  return {
    id: assetId as AssetStageReceipt["id"],
    originalFilename: "Report.pdf",
    mimeType: "application/pdf",
    storageKey: `asset-${assetId}` as AssetStorageKey,
    byteSize: 12,
    sha256,
  };
}

test("creates an immutable metadata-only asset revision and audit envelope", () => {
  const mutation = createAssetMutation(prepare(), matchingReceipt());

  expect(mutation.asset).toEqual({
    id: assetId,
    originalFilename: "Report.pdf",
    mimeType: "application/pdf",
    byteSize: 12,
    sha256,
    storageKey: `asset-${assetId}`,
    createdAt,
    provenance: {
      source: "human-ui",
      actorId: "user-1",
      requestId,
      runId: "asset-run-1",
    },
  });
  expect(mutation.revision).toEqual({
    id: revisionId,
    entityType: "asset",
    entityId: assetId,
    revisionNumber: 1,
    createdAt,
    snapshot: mutation.asset,
  });
  expect(mutation.audit).toEqual({
    id: auditId,
    timestamp: createdAt,
    actorType: "user",
    actorId: "user-1",
    action: "asset.created",
    targetType: "asset",
    targetId: assetId,
    source: "human-ui",
    requestId,
    reason: "attach evidence",
    metadata: { runId: "asset-run-1" },
    before: null,
    after: mutation.asset,
  });
  expect(mutation.revision.snapshot).not.toHaveProperty("bytes");
  expect(mutation.audit.after).not.toHaveProperty("bytes");
  expect(JSON.stringify(mutation.revision.snapshot)).not.toContain(
    "raw-fixture-byte-text",
  );
  expect(JSON.stringify(mutation.audit.after)).not.toContain(
    "raw-fixture-byte-text",
  );
});

test.each([
  ["empty filename", "", "text/plain"],
  ["parent filename", "../report.txt", "text/plain"],
  ["path separator filename", "dir\\report.txt", "text/plain"],
  ["control-character filename", "report\u0000.txt", "text/plain"],
  ["malformed MIME type", "report.txt", "text/plain; charset=utf-8"],
])(
  "rejects %s before an asset is staged",
  (_label, originalFilename, mimeType) => {
    const ids = [assetId, revisionId, auditId];

    expect(() =>
      prepareAssetCreation(
        {
          originalFilename,
          mimeType,
          actorType: "user",
          actorId: "user-1",
          source: "human-ui",
        },
        {
          newId: () => ids.shift() ?? "",
          now: () => new Date(createdAt),
        },
      ),
    ).toThrow(ValidationError);
  },
);

test("rejects invalid provenance identifiers before an asset is staged", () => {
  const ids = [assetId, revisionId, auditId];

  expect(() =>
    prepareAssetCreation(
      {
        originalFilename: "report.txt",
        mimeType: "text/plain",
        actorType: "user",
        actorId: "user-1",
        source: "human-ui",
        requestId: "not-a-native-id",
        runId: " ",
      },
      {
        newId: () => ids.shift() ?? "",
        now: () => new Date(createdAt),
      },
    ),
  ).toThrow(ValidationError);
});

test("rejects a forged prepared creation with noncanonical metadata", () => {
  const prepared = prepare();

  expect(() =>
    createAssetMutation(
      { ...prepared, originalFilename: " Report.pdf " },
      matchingReceipt(),
    ),
  ).toThrow(ValidationError);
});

test("rejects a forged prepared creation with unapproved provenance", () => {
  const prepared = prepare();

  expect(() =>
    createAssetMutation(
      {
        ...prepared,
        provenance: { ...prepared.provenance, unexpected: "raw-secret" },
      },
      matchingReceipt(),
    ),
  ).toThrow(ValidationError);
});

test.each([
  ["negative byte size", { ...matchingReceipt(), byteSize: -1 }],
  [
    "unsafe byte size",
    { ...matchingReceipt(), byteSize: Number.MAX_SAFE_INTEGER + 1 },
  ],
  ["uppercase checksum", { ...matchingReceipt(), sha256: "A".repeat(64) }],
  ["short checksum", { ...matchingReceipt(), sha256: "a".repeat(63) }],
  [
    "different asset identity",
    {
      ...matchingReceipt(),
      id: "55555555-5555-4555-8555-555555555555" as AssetStageReceipt["id"],
    },
  ],
  [
    "different opaque key",
    {
      ...matchingReceipt(),
      storageKey:
        "asset-55555555-5555-4555-8555-555555555555" as AssetStorageKey,
    },
  ],
])("rejects a stage receipt with %s", (_label, receipt) => {
  expect(() => createAssetMutation(prepare(), receipt)).toThrow(
    ValidationError,
  );
});
