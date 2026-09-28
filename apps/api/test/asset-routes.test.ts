import { expect, test, vi } from "vitest";

import type { Asset } from "../../../packages/domain/src/asset.ts";
import type { AssetStore } from "../../../packages/assets/src/asset-storage.ts";
import type { AssetMetadataRepository } from "../../../packages/database/src/asset-metadata-repository.ts";
import { asNativeId } from "../../../packages/domain/src/ids.ts";
import { buildApp } from "../src/app.ts";
import type { PageAuthorizer } from "../src/page-routes.ts";

const assetId = asNativeId("11111111-1111-4111-8111-111111111111");
const requestId = asNativeId("22222222-2222-4222-8222-222222222222");
const createdAsset: Asset = {
  id: assetId,
  originalFilename: "synthetic proof.txt",
  mimeType: "text/plain",
  byteSize: 5,
  sha256: "c1cda26362828b69266512052b97cb3729e3b052e4ade47c0a1e3383defe73c7",
  storageKey: `asset-${assetId}` as Asset["storageKey"],
  createdAt: "2026-09-25T10:00:00.000Z",
  provenance: {
    source: "nativepos.browser",
    actorId: "session-user",
    requestId,
  },
};
const clientAsset = {
  id: createdAsset.id,
  originalFilename: createdAsset.originalFilename,
  mimeType: createdAsset.mimeType,
  byteSize: createdAsset.byteSize,
  createdAt: createdAsset.createdAt,
};

function allowedAuthorizer(): PageAuthorizer {
  return async () => ({
    ok: true,
    actor: {
      actorType: "user",
      actorId: "session-user",
      source: "human-ui",
    },
  });
}

function assetApp(
  options: {
    readonly authorize?: PageAuthorizer;
    readonly maxAssetBytes?: number;
    readonly create?: (input: unknown) => Promise<Asset>;
    readonly list?: AssetMetadataRepository["list"];
    readonly getById?: AssetMetadataRepository["getById"];
    readonly read?: AssetStore["read"];
  } = {},
) {
  const create = vi.fn(options.create ?? (async () => createdAsset));
  const list = vi.fn(options.list ?? (async () => [createdAsset]));
  const getById = vi.fn(
    options.getById ??
      (async () => ({ asset: createdAsset, revisionNumber: 1 })),
  );
  const read = vi.fn(
    options.read ?? (async () => new Uint8Array(Buffer.from("proof"))),
  );
  const app = buildApp({
    authorize: options.authorize ?? allowedAuthorizer(),
    assetService: { create },
    assetRequestId: () => requestId,
    maxAssetBytes: options.maxAssetBytes ?? 16,
    assetRepository: { create, list, getById },
    assetStore: {
      stage: vi.fn(),
      read,
      verify: vi.fn(),
      discard: vi.fn(),
    },
  });
  return { app, create, list, getById, read };
}

const validHeaders = {
  "content-type": "application/octet-stream",
  "x-nativepos-filename": encodeURIComponent("synthetic proof.txt"),
  "x-nativepos-media-type": "text/plain",
};

test("requires authentication before processing asset upload bytes", async () => {
  const authorize: PageAuthorizer = async () => ({
    ok: false,
    statusCode: 401,
    error: "authentication required",
  });
  const { app, create } = assetApp({ authorize });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/assets",
    headers: validHeaders,
    payload: Buffer.from("proof"),
  });

  expect(response.statusCode).toBe(401);
  expect(response.json()).toEqual({ error: "authentication required" });
  expect(create).not.toHaveBeenCalled();
  await app.close();
});

test("requires the shared CSRF boundary for asset uploads", async () => {
  const authorize: PageAuthorizer = async (_request, requireCsrf) => {
    expect(requireCsrf).toBe(true);
    return {
      ok: false,
      statusCode: 403,
      error: "CSRF validation failed",
    };
  };
  const { app, create } = assetApp({ authorize });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/assets",
    headers: validHeaders,
    payload: Buffer.from("proof"),
  });

  expect(response.statusCode).toBe(403);
  expect(response.json()).toEqual({ error: "CSRF validation failed" });
  expect(create).not.toHaveBeenCalled();
  await app.close();
});

test("creates an asset from raw bytes with server-owned audit identity", async () => {
  const { app, create } = assetApp();

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/assets",
    headers: {
      ...validHeaders,
      "x-nativepos-actor-id": "client-controlled",
    },
    payload: Buffer.from("proof"),
  });

  expect(response.statusCode).toBe(201);
  expect(response.json()).toEqual({ asset: clientAsset });
  expect(response.body).not.toContain(createdAsset.storageKey);
  expect(response.body).not.toContain(createdAsset.sha256);
  expect(create).toHaveBeenCalledWith({
    originalFilename: "synthetic proof.txt",
    mimeType: "text/plain",
    bytes: new Uint8Array(Buffer.from("proof")),
    actorType: "user",
    actorId: "session-user",
    source: "nativepos.browser",
    requestId,
  });
  await app.close();
});

test("rejects unsupported upload content types before asset creation", async () => {
  const { app, create } = assetApp();
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/assets",
    headers: {
      "content-type": "application/json",
      "x-nativepos-filename": "proof.txt",
      "x-nativepos-media-type": "text/plain",
    },
    payload: { bytes: "proof" },
  });

  expect(response.statusCode).toBe(415);
  expect(response.json()).toEqual({ error: "unsupported asset content type" });
  expect(create).not.toHaveBeenCalled();
  await app.close();
});

test.each([
  ["missing", undefined],
  ["malformed percent encoding", "%E0%A4%A"],
  ["path separator", "folder%2Fproof.txt"],
  ["control character", "proof%00.txt"],
  ["oversized", "a".repeat(256)],
] as const)("rejects %s filename metadata", async (_label, filename) => {
  const { app, create } = assetApp();
  const headers: Record<string, string> = {
    "content-type": "application/octet-stream",
    "x-nativepos-media-type": "text/plain",
  };
  if (filename !== undefined) headers["x-nativepos-filename"] = filename;

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/assets",
    headers,
    payload: Buffer.from("proof"),
  });

  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({ error: "invalid asset request" });
  expect(create).not.toHaveBeenCalled();
  await app.close();
});

test("rejects duplicated filename metadata", async () => {
  const { app, create } = assetApp();
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/assets",
    headers: {
      ...validHeaders,
      "x-nativepos-filename": ["first.txt", "second.txt"],
    },
    payload: Buffer.from("proof"),
  });

  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({ error: "invalid asset request" });
  expect(create).not.toHaveBeenCalled();
  await app.close();
});

test("rejects invalid declared MIME metadata", async () => {
  const { app, create } = assetApp();
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/assets",
    headers: { ...validHeaders, "x-nativepos-media-type": "not a mime" },
    payload: Buffer.from("proof"),
  });

  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({ error: "invalid asset request" });
  expect(create).not.toHaveBeenCalled();
  await app.close();
});

test("rejects an oversized upload before asset creation", async () => {
  const { app, create } = assetApp({ maxAssetBytes: 4 });
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/assets",
    headers: validHeaders,
    payload: Buffer.from("proof"),
  });

  expect(response.statusCode).toBe(413);
  expect(response.json()).toEqual({ error: "asset exceeds configured limit" });
  expect(create).not.toHaveBeenCalled();
  await app.close();
});

test("accepts an empty file as a bounded byte snapshot", async () => {
  const { app, create } = assetApp();
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/assets",
    headers: validHeaders,
    payload: Buffer.alloc(0),
  });

  expect(response.statusCode).toBe(201);
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ bytes: new Uint8Array() }),
  );
  await app.close();
});

test("does not expose asset persistence failures", async () => {
  const { app } = assetApp({
    create: async () => {
      throw new Error("database path and secret detail");
    },
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/assets",
    headers: validHeaders,
    payload: Buffer.from("proof"),
  });

  expect(response.statusCode).toBe(500);
  expect(response.json()).toEqual({ error: "asset creation failed" });
  expect(response.body).not.toContain("database path");
  await app.close();
});

test("requires authentication before listing assets", async () => {
  const authorize: PageAuthorizer = async (_request, requireCsrf) => {
    expect(requireCsrf).toBe(false);
    return {
      ok: false,
      statusCode: 401,
      error: "authentication required",
    };
  };
  const { app, list } = assetApp({ authorize });

  const response = await app.inject({ method: "GET", url: "/api/v1/assets" });

  expect(response.statusCode).toBe(401);
  expect(response.json()).toEqual({ error: "authentication required" });
  expect(list).not.toHaveBeenCalled();
  await app.close();
});

test("lists assets in repository order with a default bound of 50", async () => {
  const laterAsset = { ...createdAsset, id: requestId };
  const { app, list } = assetApp({
    list: async () => [laterAsset, createdAsset],
  });

  const response = await app.inject({ method: "GET", url: "/api/v1/assets" });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    assets: [{ ...clientAsset, id: laterAsset.id }, clientAsset],
  });
  expect(response.body).not.toContain(createdAsset.storageKey);
  expect(response.body).not.toContain(createdAsset.sha256);
  expect(list).toHaveBeenCalledWith(50);
  await app.close();
});

test.each([1, 100])("accepts asset list limit %i", async (limit) => {
  const { app, list } = assetApp();
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/assets?limit=${limit}`,
  });

  expect(response.statusCode).toBe(200);
  expect(list).toHaveBeenCalledWith(limit);
  await app.close();
});

test.each(["0", "101", "1.5", "nope", "1&limit=2"])(
  "rejects invalid asset list limit %s",
  async (query) => {
    const { app, list } = assetApp();
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/assets?limit=${query}`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid asset query" });
    expect(list).not.toHaveBeenCalled();
    await app.close();
  },
);

test("validates the native asset ID before download lookup", async () => {
  const { app, getById, read } = assetApp();
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/assets/not-an-id/content",
  });

  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({ error: "invalid asset ID" });
  expect(getById).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  await app.close();
});

test("returns 404 without reading storage when asset metadata is absent", async () => {
  const { app, read } = assetApp({ getById: async () => null });
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/assets/${assetId}/content`,
  });

  expect(response.statusCode).toBe(404);
  expect(response.json()).toEqual({ error: "asset not found" });
  expect(read).not.toHaveBeenCalled();
  await app.close();
});

test("returns integrity-verified bytes with fixed safe attachment headers", async () => {
  const { app, getById, read } = assetApp();
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/assets/${assetId}/content`,
  });

  expect(response.statusCode).toBe(200);
  expect(response.rawPayload).toEqual(Buffer.from("proof"));
  expect(response.headers["content-type"]).toBe("application/octet-stream");
  expect(response.headers["x-content-type-options"]).toBe("nosniff");
  expect(response.headers["content-length"]).toBe("5");
  expect(response.headers["content-disposition"]).toBe(
    `attachment; filename="asset-${assetId}"`,
  );
  expect(getById).toHaveBeenCalledWith(assetId);
  expect(read).toHaveBeenCalledWith(createdAsset.storageKey);
  await app.close();
});

test.each([
  ["missing storage", new Error("ENOENT C:\\secret\\asset")],
  ["changed storage", new Error("asset changed during read")],
  ["symlinked storage", new Error("asset is a symlink")],
] as const)("fails closed for %s", async (_label, failure) => {
  const { app } = assetApp({
    read: async () => {
      throw failure;
    },
  });
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/assets/${assetId}/content`,
  });

  expect(response.statusCode).toBe(409);
  expect(response.json()).toEqual({ error: "asset integrity check failed" });
  expect(response.body).not.toContain(failure.message);
  await app.close();
});

test.each([
  ["oversized", new Uint8Array(Buffer.from("proof!"))],
  ["truncated", new Uint8Array(Buffer.from("proo"))],
  ["checksum mismatched", new Uint8Array(Buffer.from("other"))],
] as const)("fails closed for %s bytes", async (_label, bytes) => {
  const { app } = assetApp({ read: async () => bytes });
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/assets/${assetId}/content`,
  });

  expect(response.statusCode).toBe(409);
  expect(response.json()).toEqual({ error: "asset integrity check failed" });
  expect(response.body).not.toContain(createdAsset.sha256);
  expect(response.body).not.toContain(createdAsset.originalFilename);
  await app.close();
});
