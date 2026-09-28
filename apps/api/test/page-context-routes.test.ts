import { expect, test, vi } from "vitest";
import { asNativeId } from "../../../packages/domain/src/ids.ts";
import type { Page } from "../../../packages/domain/src/page.ts";
import type { PageLink } from "../../../packages/domain/src/page-link.ts";
import { buildApp } from "../src/app.ts";

const root = asNativeId("11111111-1111-4111-8111-111111111111");
const alpha = asNativeId("22222222-2222-4222-8222-222222222222");
const beta = asNativeId("33333333-3333-4333-8333-333333333333");
const page = (
  id: typeof root,
  title: string,
  archivedAt: string | null = null,
): Page => ({
  id,
  parentId: null,
  title,
  archivedAt,
  createdAt: "2026-09-28T12:00:00.000Z",
  modifiedAt: "2026-09-28T12:00:00.000Z",
  provenance: { source: "test", actorId: "owner" },
});
const link = (
  id: string,
  sourcePageId: typeof root,
  targetPageId: typeof root,
  createdAt: string,
): PageLink => ({
  id: asNativeId(id),
  sourcePageId,
  targetPageId,
  createdAt,
  archivedAt: null,
  provenance: { source: "test", actorId: "owner" },
});
function app(options: {
  root?: Page | null;
  forward?: readonly unknown[];
  backlinks?: readonly unknown[];
  authorized?: boolean;
}) {
  const listForward = vi.fn(async () => options.forward ?? []);
  const listBacklinks = vi.fn(async () => options.backlinks ?? []);
  return {
    api: buildApp({
      pageRepository: {
        getById: vi.fn(async () =>
          options.root === null
            ? null
            : { page: options.root ?? page(root, "Root"), revisionNumber: 1 },
        ),
        create: vi.fn(),
        update: vi.fn(),
        list: vi.fn(),
      },
      pageLinkRepository: {
        create: vi.fn(),
        archive: vi.fn(),
        getActive: vi.fn(),
        listForward: listForward as never,
        listBacklinks: listBacklinks as never,
      },
      authorize: (async () =>
        options.authorized === false
          ? { ok: false, statusCode: 401, error: "authentication required" }
          : {
              ok: true,
              actor: { actorType: "user", actorId: "owner", source: "test" },
            }) as never,
    }),
    listForward,
    listBacklinks,
  };
}

test("returns deterministic depth-one forward and backlink context with deduplicated nodes", async () => {
  const sharedForward = link(
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    root,
    alpha,
    "2026-09-28T12:02:00.000Z",
  );
  const earlierForward = link(
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    root,
    beta,
    "2026-09-28T12:01:00.000Z",
  );
  const incoming = link(
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    alpha,
    root,
    "2026-09-28T12:00:00.000Z",
  );
  const { api } = app({
    forward: [
      { link: sharedForward, page: { id: alpha, title: "Alpha" } },
      { link: earlierForward, page: { id: beta, title: "Beta" } },
    ],
    backlinks: [{ link: incoming, page: { id: alpha, title: "Alpha" } }],
  });
  const response = await api.inject({
    method: "GET",
    url: `/api/v1/pages/${root}/context?limit=20`,
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    root: { id: root, title: "Root" },
    depth: 1,
    nodes: [
      { id: alpha, title: "Alpha" },
      { id: beta, title: "Beta" },
      { id: root, title: "Root" },
    ],
    edges: [
      { direction: "forward", link: earlierForward },
      { direction: "forward", link: sharedForward },
      { direction: "backlink", link: incoming },
    ],
    truncated: { forward: false, backlinks: false },
  });
  await api.close();
});

test("fetches limit plus one per direction and reports independent truncation", async () => {
  const entries = [alpha, beta].map((id, index) => ({
    link: link(
      `${index + 1}0000000-0000-4000-8000-000000000000`,
      root,
      id,
      `2026-09-28T12:0${index}:00.000Z`,
    ),
    page: { id, title: index === 0 ? "Alpha" : "Beta" },
  }));
  const { api, listForward, listBacklinks } = app({
    forward: entries,
    backlinks: entries.map((entry) => ({
      link: { ...entry.link, sourcePageId: entry.page.id, targetPageId: root },
      page: entry.page,
    })),
  });
  const response = await api.inject({
    method: "GET",
    url: `/api/v1/pages/${root}/context?limit=1`,
  });
  expect(response.json().edges).toHaveLength(2);
  expect(response.json().truncated).toEqual({ forward: true, backlinks: true });
  expect(listForward).toHaveBeenCalledWith(root, { scope: "active", limit: 2 });
  expect(listBacklinks).toHaveBeenCalledWith(root, {
    scope: "active",
    limit: 2,
  });
  await api.close();
});

test.each([
  ["missing", null, 404, "page not found"],
  [
    "archived",
    page(root, "Root", "2026-09-28T13:00:00.000Z"),
    409,
    "page is archived",
  ],
] as const)("rejects a %s root", async (_label, rootPage, status, error) => {
  const { api } = app({ root: rootPage });
  const response = await api.inject({
    method: "GET",
    url: `/api/v1/pages/${root}/context`,
  });
  expect(response.statusCode).toBe(status);
  expect(response.json()).toEqual({ error });
  await api.close();
});

test("requires authentication and validates UUID and limit", async () => {
  const unauthorized = app({ authorized: false }).api;
  expect(
    (
      await unauthorized.inject({
        method: "GET",
        url: `/api/v1/pages/${root}/context`,
      })
    ).statusCode,
  ).toBe(401);
  await unauthorized.close();
  const { api } = app({});
  expect(
    (await api.inject({ method: "GET", url: "/api/v1/pages/no/context" }))
      .statusCode,
  ).toBe(400);
  expect(
    (
      await api.inject({
        method: "GET",
        url: `/api/v1/pages/${root}/context?limit=21`,
      })
    ).statusCode,
  ).toBe(400);
  await api.close();
});

test("fails closed on malformed or corrupt relationship output", async () => {
  let { api } = app({
    forward: [{ link: {}, page: { id: alpha, title: "Alpha" } }],
  });
  let response = await api.inject({
    method: "GET",
    url: `/api/v1/pages/${root}/context`,
  });
  expect(response.statusCode).toBe(500);
  expect(response.json()).toEqual({ error: "page context is unavailable" });
  await api.close();
  ({ api } = app({
    forward: Promise.reject(
      new Error("page link revision history is invalid"),
    ) as never,
  }));
  response = await api.inject({
    method: "GET",
    url: `/api/v1/pages/${root}/context`,
  });
  expect(response.statusCode).toBe(500);
  expect(response.json()).toEqual({ error: "page context is unavailable" });
  await api.close();
});

test("fails closed when a relationship does not connect the root and returned neighbour", async () => {
  const { api } = app({
    forward: [
      {
        link: link(
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          beta,
          alpha,
          "2026-09-28T12:00:00.000Z",
        ),
        page: { id: alpha, title: "Alpha" },
      },
    ],
  });
  const response = await api.inject({
    method: "GET",
    url: `/api/v1/pages/${root}/context`,
  });
  expect(response.statusCode).toBe(500);
  expect(response.json()).toEqual({ error: "page context is unavailable" });
  await api.close();
});
