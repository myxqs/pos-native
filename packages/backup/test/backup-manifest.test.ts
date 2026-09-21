import { expect, test } from "vitest";

import { asAssetStorageKey } from "../../assets/src/asset-storage.ts";
import { asNativeId, ValidationError } from "../../domain/src/ids.ts";
import {
  createBackupManifest,
  parseBackupManifest,
  serializeBackupManifest,
  sha256ForBytes,
} from "../src/backup-manifest.ts";

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

function manifestInput() {
  return {
    backupId,
    createdAt: "2026-09-21T00:00:00.000Z",
    source: {
      schemaVersion: "0004",
      applicationVersion: "0.1.0",
      databaseDumpFormat: "postgresql-custom-v1" as const,
      assetStoreFormat: "filesystem-v1" as const,
    },
    database: {
      relativePath: "database/canonical.dump",
      byteSize: 8,
      sha256: sha256ForBytes(encoder.encode("database")),
    },
    assets: [
      {
        assetId: secondAssetId,
        storageKey: secondKey,
        relativePath: `assets/${secondKey}`,
        byteSize: 6,
        sha256: sha256ForBytes(encoder.encode("second")),
      },
      {
        assetId: firstAssetId,
        storageKey: firstKey,
        relativePath: `assets/${firstKey}`,
        byteSize: 5,
        sha256: sha256ForBytes(encoder.encode("first")),
      },
    ],
  };
}

test("creates a canonical sorted manifest that round trips through its checksum", () => {
  const first = createBackupManifest(manifestInput());
  const second = createBackupManifest({
    ...manifestInput(),
    assets: [...manifestInput().assets].reverse(),
  });

  expect(first.format).toBe("pos-native-backup");
  expect(first.formatVersion).toBe(1);
  expect(first.assets.map((asset) => asset.assetId)).toEqual([
    firstAssetId,
    secondAssetId,
  ]);
  expect(serializeBackupManifest(first)).toBe(serializeBackupManifest(second));
  expect(serializeBackupManifest(first).endsWith("\n")).toBe(true);
  expect(parseBackupManifest(serializeBackupManifest(first))).toEqual(first);
});

test("rejects a manifest whose content no longer matches its recorded checksum", () => {
  const serialized = serializeBackupManifest(
    createBackupManifest(manifestInput()),
  );
  const tampered = serialized.replace(
    '"schemaVersion": "0004"',
    '"schemaVersion": "0005"',
  );

  expect(() => parseBackupManifest(tampered)).toThrow(ValidationError);
});

test("rejects unknown fields and unsupported format versions", () => {
  const manifest = createBackupManifest(manifestInput());
  const unknownField = JSON.stringify({ ...manifest, accidental: true });
  const unsupportedVersion = JSON.stringify({ ...manifest, formatVersion: 2 });

  expect(() => parseBackupManifest(unknownField)).toThrow(ValidationError);
  expect(() => parseBackupManifest(unsupportedVersion)).toThrow(
    ValidationError,
  );
});

test("rejects non-canonical timestamps and duplicate asset identity", () => {
  expect(() =>
    createBackupManifest({
      ...manifestInput(),
      createdAt: "2026-09-21T00:00:00Z",
    }),
  ).toThrow(ValidationError);

  const duplicate = manifestInput().assets[0];
  if (duplicate === undefined) throw new Error("test fixture missing asset");
  expect(() =>
    createBackupManifest({
      ...manifestInput(),
      assets: [duplicate, { ...duplicate, relativePath: `assets/${firstKey}` }],
    }),
  ).toThrow(ValidationError);
});

test.each([
  "../escape",
  "/absolute",
  "C:\\drive",
  "\\\\server\\share",
  `assets\\${firstKey}`,
  "assets/not-a-native-key",
])("rejects unsafe or non-canonical asset path %j", (relativePath) => {
  const firstAsset = manifestInput().assets[0];
  if (firstAsset === undefined) throw new Error("test fixture missing asset");

  expect(() =>
    createBackupManifest({
      ...manifestInput(),
      assets: [{ ...firstAsset, relativePath }],
    }),
  ).toThrow(ValidationError);
});
