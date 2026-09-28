import { expect, test, vi } from "vitest";

import { asNativeId } from "../../../packages/domain/src/ids.ts";
import {
  asAssetStorageKey,
  type Asset,
} from "../../../packages/domain/src/asset.ts";
import type { Page } from "../../../packages/domain/src/page.ts";
import type {
  CreatePageAssetLinkMutation,
  PageAssetLink,
} from "../../../packages/domain/src/page-asset-link.ts";
import { buildApp } from "../src/app.ts";
import type { PageAuthorizer } from "../src/page-routes.ts";

const pageId = asNativeId("11111111-1111-4111-8111-111111111111");
const assetId = asNativeId("22222222-2222-4222-8222-222222222222");
const page: Page = {
  id: pageId,
  parentId: null,
  title: "Page",
  archivedAt: null,
  createdAt: "2026-09-28T12:00:00.000Z",
  modifiedAt: "2026-09-28T12:00:00.000Z",
  provenance: { source: "test", actorId: "owner" },
};
const asset: Asset = {
  id: assetId,
  originalFilename: "proof.txt",
  mimeType: "text/plain",
  byteSize: 5,
  sha256: "a".repeat(64),
  storageKey: asAssetStorageKey(`asset-${assetId}`),
  createdAt: "2026-09-28T12:00:00.000Z",
  provenance: { source: "test", actorId: "owner" },
};

function app(
  overrides: {
    page?: typeof page | null;
    asset?: typeof asset | null;
    create?: (mutation: CreatePageAssetLinkMutation) => Promise<PageAssetLink>;
    authorize?: (request: unknown, csrf: boolean) => Promise<unknown>;
    list?: () => Promise<readonly PageAssetLink[]>;
  } = {},
) {
  return buildApp({
    pageRepository: {
      getById: vi.fn(async () =>
        overrides.page === undefined
          ? { page, revisionNumber: 1 }
          : overrides.page && { page: overrides.page, revisionNumber: 1 },
      ),
      create: vi.fn(),
      update: vi.fn(),
      list: vi.fn(),
    },
    assetRepository: {
      getById: vi.fn(async () =>
        overrides.asset === undefined
          ? { asset, revisionNumber: 1 }
          : overrides.asset && { asset: overrides.asset, revisionNumber: 1 },
      ),
      create: vi.fn(),
      list: vi.fn(),
    },
    pageAssetLinkRepository: {
      create: vi.fn(
        overrides.create ??
          (async (mutation: CreatePageAssetLinkMutation) => mutation.link),
      ),
      listForPage: vi.fn(overrides.list ?? (async () => [])),
    },
    pageAssetLinkDependencies: {
      newId: () => crypto.randomUUID(),
      now: () => new Date("2026-09-28T12:00:00Z"),
    },
    authorize: (overrides.authorize ??
      (async () => ({
        ok: true,
        actor: { actorType: "user", actorId: "owner", source: "human-ui" },
      }))) as PageAuthorizer,
  });
}

test("attaches an existing asset to a live page with CSRF authorization", async () => {
  const api = app();
  const response = await api.inject({
    method: "POST",
    url: `/api/v1/pages/${pageId}/assets/${assetId}`,
  });
  expect(response.statusCode).toBe(201);
  expect(response.json().link).toMatchObject({ pageId, assetId });
  await api.close();
});

test("rejects attaching to an archived page without mutation", async () => {
  const create = vi.fn();
  const api = app({
    page: { ...page, archivedAt: "2026-09-28T13:00:00.000Z" },
    create,
  });
  const response = await api.inject({
    method: "POST",
    url: `/api/v1/pages/${pageId}/assets/${assetId}`,
  });
  expect(response.statusCode).toBe(409);
  expect(create).not.toHaveBeenCalled();
  await api.close();
});

test("returns not found for a missing asset", async () => {
  const api = app({ asset: null });
  const response = await api.inject({
    method: "POST",
    url: `/api/v1/pages/${pageId}/assets/${assetId}`,
  });
  expect(response.statusCode).toBe(404);
  await api.close();
});

test("requires authentication to list linked assets", async () => {
  const api = app({
    authorize: async () => ({
      ok: false,
      statusCode: 401,
      error: "authentication required",
    }),
  });
  const response = await api.inject({
    method: "GET",
    url: `/api/v1/pages/${pageId}/assets`,
  });
  expect(response.statusCode).toBe(401);
  await api.close();
});

test("returns a fixed error when persisted linkage is inconsistent", async () => {
  const link: PageAssetLink = {
    id: asNativeId("77777777-7777-4777-8777-777777777777"),
    pageId,
    assetId,
    createdAt: "2026-09-28T12:00:00.000Z",
    provenance: { source: "test", actorId: "owner" },
  };
  const api = app({ asset: null, list: async () => [link] });
  const response = await api.inject({
    method: "GET",
    url: `/api/v1/pages/${pageId}/assets`,
  });
  expect(response.statusCode).toBe(500);
  expect(response.json()).toEqual({ error: "linked asset listing failed" });
  await api.close();
});
