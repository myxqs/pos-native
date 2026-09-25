import { expect, test, vi } from "vitest";

import type { Asset } from "../../../packages/domain/src/asset.ts";
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
  sha256: "a".repeat(64),
  storageKey: `asset-${assetId}` as Asset["storageKey"],
  createdAt: "2026-09-25T10:00:00.000Z",
  provenance: {
    source: "nativepos.browser",
    actorId: "session-user",
    requestId,
  },
};

function allowedAuthorizer(): PageAuthorizer {
  return async (_request, requireCsrf) => {
    if (!requireCsrf) throw new Error("asset upload must require CSRF");
    return {
      ok: true,
      actor: {
        actorType: "user",
        actorId: "session-user",
        source: "human-ui",
      },
    };
  };
}

function assetApp(
  options: {
    readonly authorize?: PageAuthorizer;
    readonly maxAssetBytes?: number;
    readonly create?: (input: unknown) => Promise<Asset>;
  } = {},
) {
  const create = vi.fn(options.create ?? (async () => createdAsset));
  const app = buildApp({
    authorize: options.authorize ?? allowedAuthorizer(),
    assetService: { create },
    assetRequestId: () => requestId,
    maxAssetBytes: options.maxAssetBytes ?? 16,
  });
  return { app, create };
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
  expect(response.json()).toEqual({ asset: createdAsset });
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
