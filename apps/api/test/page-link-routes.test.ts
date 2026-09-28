import { expect, test, vi } from "vitest";
import { asNativeId } from "../../../packages/domain/src/ids.ts";
import type { Page } from "../../../packages/domain/src/page.ts";
import type {
  ArchivePageLinkMutation,
  CreatePageLinkMutation,
  PageLink,
} from "../../../packages/domain/src/page-link.ts";
import { PageLinkConflictError } from "../../../packages/database/src/page-link-repository.ts";
import { buildApp } from "../src/app.ts";

const source = asNativeId("11111111-1111-4111-8111-111111111111"),
  target = asNativeId("22222222-2222-4222-8222-222222222222");
const page = (
  id: string,
  title: string,
  archivedAt: string | null = null,
): Page => ({
  id: asNativeId(id),
  parentId: null,
  title,
  archivedAt,
  createdAt: "2026-09-28T12:00:00.000Z",
  modifiedAt: "2026-09-28T12:00:00.000Z",
  provenance: { source: "test", actorId: "owner" },
});
const pages = new Map([
  [source, page(source, "Source")],
  [target, page(target, "Target")],
]);
function app(
  overrides: {
    authorize?: (request: unknown, csrf: boolean) => Promise<unknown>;
    create?: (m: CreatePageLinkMutation) => Promise<PageLink>;
    active?: { link: PageLink; revisionNumber: number } | null;
    list?: () => Promise<
      readonly { link: PageLink; page: { id: typeof source; title: string } }[]
    >;
    archive?: (m: ArchivePageLinkMutation) => Promise<PageLink>;
  } = {},
) {
  return buildApp({
    pageRepository: {
      getById: vi.fn(async (id) => {
        const found = pages.get(id);
        return found ? { page: found, revisionNumber: 1 } : null;
      }),
      create: vi.fn(),
      update: vi.fn(),
      list: vi.fn(),
    },
    pageLinkRepository: {
      create: vi.fn(overrides.create ?? (async (m) => m.link)),
      archive: vi.fn(overrides.archive ?? (async (m) => m.link)),
      getActive: vi.fn(async () => overrides.active ?? null),
      listForward: vi.fn(overrides.list ?? (async () => [])),
      listBacklinks: vi.fn(overrides.list ?? (async () => [])),
    },
    pageLinkDependencies: {
      newId: () => crypto.randomUUID(),
      now: () => new Date("2026-09-28T12:00:00Z"),
    },
    authorize: (overrides.authorize ??
      (async () => ({
        ok: true,
        actor: { actorType: "user", actorId: "owner", source: "human-ui" },
      }))) as never,
  });
}
test("creates a link through authenticated CSRF mutation", async () => {
  const api = app();
  const response = await api.inject({
    method: "POST",
    url: `/api/v1/pages/${source}/links/${target}`,
  });
  expect(response.statusCode).toBe(201);
  expect(response.json().link).toMatchObject({
    sourcePageId: source,
    targetPageId: target,
  });
  await api.close();
});
test("rejects self, missing, archived, duplicate, and unauthorised mutations", async () => {
  let api = app();
  expect(
    (
      await api.inject({
        method: "POST",
        url: `/api/v1/pages/${source}/links/${source}`,
      })
    ).statusCode,
  ).toBe(400);
  await api.close();
  api = app({
    create: async () => {
      throw new PageLinkConflictError();
    },
  });
  expect(
    (
      await api.inject({
        method: "POST",
        url: `/api/v1/pages/${source}/links/${target}`,
      })
    ).statusCode,
  ).toBe(409);
  await api.close();
  api = app({
    authorize: async () => ({
      ok: false,
      statusCode: 403,
      error: "invalid CSRF token",
    }),
  });
  expect(
    (
      await api.inject({
        method: "POST",
        url: `/api/v1/pages/${source}/links/${target}`,
      })
    ).statusCode,
  ).toBe(403);
  await api.close();
});
test("lists forward links and backlinks with bounded validated output", async () => {
  const link: PageLink = {
    id: asNativeId("33333333-3333-4333-8333-333333333333"),
    sourcePageId: source,
    targetPageId: target,
    createdAt: "2026-09-28T12:00:00.000Z",
    archivedAt: null,
    provenance: { source: "test", actorId: "owner" },
  };
  const api = app({
    list: async () => [{ link, page: { id: target, title: "Target" } }],
  });
  for (const suffix of ["links", "backlinks"]) {
    const response = await api.inject({
      method: "GET",
      url: `/api/v1/pages/${source}/${suffix}?limit=10`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
  }
  expect(
    (
      await api.inject({
        method: "GET",
        url: `/api/v1/pages/${source}/links?limit=101`,
      })
    ).statusCode,
  ).toBe(400);
  await api.close();
});
test("archives an active link and requires CSRF", async () => {
  const link: PageLink = {
    id: asNativeId("33333333-3333-4333-8333-333333333333"),
    sourcePageId: source,
    targetPageId: target,
    createdAt: "2026-09-28T12:00:00.000Z",
    archivedAt: null,
    provenance: { source: "test", actorId: "owner" },
  };
  const api = app({ active: { link, revisionNumber: 1 } });
  const response = await api.inject({
    method: "DELETE",
    url: `/api/v1/pages/${source}/links/${target}`,
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().link.archivedAt).not.toBeNull();
  await api.close();
});
