import { describe, expect, test } from "vitest";

import { asNativeId, ValidationError } from "../../domain/src/ids.ts";
import {
  asAssetStorageKey,
  DEFAULT_MAX_ASSET_BYTES,
  normaliseAssetMetadata,
  storageKeyForAsset,
  validateAssetByteSize,
} from "../src/asset-storage.ts";

const assetId = asNativeId("11111111-1111-4111-8111-111111111111");

test("derives and validates an opaque asset key from a native ID", () => {
  expect(storageKeyForAsset(assetId)).toBe(
    "asset-11111111-1111-4111-8111-111111111111",
  );
  expect(() => asAssetStorageKey("../evidence.pdf")).toThrow(ValidationError);
  expect(() =>
    asAssetStorageKey("asset-11111111-1111-1111-8111-111111111111"),
  ).toThrow(ValidationError);
});

test("normalises safe metadata without using the filename as a path", () => {
  expect(
    normaliseAssetMetadata({
      originalFilename: "  evidence.pdf  ",
      mimeType: " Text/Plain ",
    }),
  ).toEqual({ originalFilename: "evidence.pdf", mimeType: "text/plain" });

  expect(
    normaliseAssetMetadata({
      originalFilename: "cafe\u0301.txt",
      mimeType: "application/vnd.api+json",
    }),
  ).toEqual({
    originalFilename: "café.txt",
    mimeType: "application/vnd.api+json",
  });
});

describe("unsafe asset input", () => {
  test.each([
    "../evidence.pdf",
    "folder/evidence.pdf",
    "folder\\evidence.pdf",
    "bad\u0000name",
    "bad\u001fname",
    "bad\u007fname",
    "   ",
    `${"a".repeat(252)}.txt`,
  ])("rejects filename %j", (originalFilename) => {
    expect(() =>
      normaliseAssetMetadata({ originalFilename, mimeType: "text/plain" }),
    ).toThrow(ValidationError);
  });

  test.each([
    "text/plain; charset=utf-8",
    "text /plain",
    "text/\u0000plain",
    "text",
    "text/",
    "text/pl(ain",
  ])("rejects MIME value %j", (mimeType) => {
    expect(() =>
      normaliseAssetMetadata({
        originalFilename: "evidence.txt",
        mimeType,
      }),
    ).toThrow(ValidationError);
  });

  test("rejects non-string metadata at the runtime boundary", () => {
    expect(() =>
      normaliseAssetMetadata({
        originalFilename: 1 as unknown as string,
        mimeType: "text/plain",
      }),
    ).toThrow(ValidationError);
    expect(() =>
      normaliseAssetMetadata({
        originalFilename: "evidence.txt",
        mimeType: null as unknown as string,
      }),
    ).toThrow(ValidationError);
  });
});

test("requires a non-negative safe byte size within a positive safe limit", () => {
  expect(validateAssetByteSize(0, 10)).toBe(0);
  expect(validateAssetByteSize(10, 10)).toBe(10);
  expect(() => validateAssetByteSize(-1, 10)).toThrow(ValidationError);
  expect(() => validateAssetByteSize(11, 10)).toThrow(ValidationError);
  expect(() => validateAssetByteSize(1.5, 10)).toThrow(ValidationError);
  expect(() => validateAssetByteSize(1, 0)).toThrow(ValidationError);
  expect(() => validateAssetByteSize(1, Number.MAX_VALUE)).toThrow(
    ValidationError,
  );
  expect(DEFAULT_MAX_ASSET_BYTES).toBe(50 * 1024 * 1024);
});
