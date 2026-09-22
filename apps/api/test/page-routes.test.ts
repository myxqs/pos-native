import { expect, test, vi } from "vitest";

import { InMemoryPageRepository } from "../../../packages/database/src/page-repository.ts";
import { buildApp } from "../src/app.ts";
import type { PageAuthorizer } from "../src/page-routes.ts";

function pageApp(options: { readonly authorize?: PageAuthorizer } = {}) {
  let nextId = 1;
  return buildApp({
    pageRepository: new InMemoryPageRepository(),
    pageDependencies: {
      newId: () =>
        `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
      now: () => new Date("2026-09-16T12:00:00.000Z"),
    },
    authorize:
      options.authorize ??
      (async () => ({
        ok: true as const,
        actor: {
          actorType: "user" as const,
          actorId: "user-1",
          source: "human-ui",
        },
      })),
  });
}

test("creates, lists, reads, and updates a page through the versioned API", async () => {
  const app = pageApp();
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/pages",
    payload: { title: "Domain" },
  });
  expect(created.statusCode).toBe(201);
  expect(created.json().page.title).toBe("Domain");
  const id = created.json().page.id as string;

  const listed = await app.inject({ method: "GET", url: "/api/v1/pages" });
  expect(listed.statusCode).toBe(200);
  expect(listed.json().pages).toHaveLength(1);

  const read = await app.inject({ method: "GET", url: "/api/v1/pages/" + id });
  expect(read.statusCode).toBe(200);
  expect(read.json()).toMatchObject({
    page: { id, title: "Domain" },
    revisionNumber: 1,
  });

  const updated = await app.inject({
    method: "PATCH",
    url: "/api/v1/pages/" + id,
    headers: { "if-match": "1" },
    payload: { title: "Projects" },
  });
  expect(updated.statusCode).toBe(200);
  expect(updated.json()).toMatchObject({
    page: { id, title: "Projects" },
    revisionNumber: 2,
  });
  await app.close();
});

test("rejects missing, malformed, and stale page revision preconditions", async () => {
  const app = pageApp();
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/pages",
    payload: { title: "Domain" },
  });
  const id = created.json().page.id as string;

  const missing = await app.inject({
    method: "PATCH",
    url: "/api/v1/pages/" + id,
    payload: { title: "Missing revision" },
  });
  expect(missing.statusCode).toBe(400);
  expect(missing.json()).toEqual({ error: "invalid page revision" });

  const malformed = await app.inject({
    method: "PATCH",
    url: "/api/v1/pages/" + id,
    headers: { "if-match": "zero" },
    payload: { title: "Malformed revision" },
  });
  expect(malformed.statusCode).toBe(400);
  expect(malformed.json()).toEqual({ error: "invalid page revision" });

  const current = await app.inject({
    method: "PATCH",
    url: "/api/v1/pages/" + id,
    headers: { "if-match": "1" },
    payload: { title: "Projects" },
  });
  expect(current.statusCode).toBe(200);

  const stale = await app.inject({
    method: "PATCH",
    url: "/api/v1/pages/" + id,
    headers: { "if-match": "1" },
    payload: { title: "Stale title" },
  });
  expect(stale.statusCode).toBe(409);
  expect(stale.json()).toEqual({ error: "page revision conflict" });
  await app.close();
});

test("rejects invalid page input and reports missing pages", async () => {
  const app = pageApp();
  const invalid = await app.inject({
    method: "POST",
    url: "/api/v1/pages",
    payload: { title: "   " },
  });
  expect(invalid.statusCode).toBe(400);
  expect(invalid.json()).toEqual({ error: "invalid page request" });

  const missing = await app.inject({
    method: "GET",
    url: "/api/v1/pages/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  expect(missing.statusCode).toBe(404);
  expect(missing.json()).toEqual({ error: "page not found" });
  await app.close();
});

test("creates nested pages and scopes active versus archived navigation", async () => {
  const app = pageApp();
  const root = await app.inject({
    method: "POST",
    url: "/api/v1/pages",
    payload: { title: "Root" },
  });
  const rootId = root.json().page.id as string;
  const child = await app.inject({
    method: "POST",
    url: "/api/v1/pages",
    payload: { title: "Child", parentId: rootId },
  });
  const childId = child.json().page.id as string;

  expect(child.statusCode).toBe(201);
  expect(child.json().page.parentId).toBe(rootId);
  const active = await app.inject({ method: "GET", url: "/api/v1/pages" });
  expect(active.json().pages.map((page: { id: string }) => page.id)).toEqual([
    rootId,
    childId,
  ]);

  const archived = await app.inject({
    method: "POST",
    url: "/api/v1/pages/" + childId + "/archive",
    headers: { "if-match": "1" },
    payload: {},
  });
  expect(archived.statusCode).toBe(200);
  expect(archived.json()).toMatchObject({
    page: { id: childId, archivedAt: "2026-09-16T12:00:00.000Z" },
    revisionNumber: 2,
  });

  const activeAfterArchive = await app.inject({
    method: "GET",
    url: "/api/v1/pages",
  });
  expect(activeAfterArchive.json().pages).toMatchObject([{ id: rootId }]);
  const archivedOnly = await app.inject({
    method: "GET",
    url: "/api/v1/pages?archived=only",
  });
  expect(archivedOnly.json().pages).toMatchObject([{ id: childId }]);

  const invalidScope = await app.inject({
    method: "GET",
    url: "/api/v1/pages?archived=all",
  });
  expect(invalidScope.statusCode).toBe(400);
  expect(invalidScope.json()).toEqual({ error: "invalid page query" });
  await app.close();
});

test("rejects client audit fields and invalid parent references", async () => {
  const app = pageApp();
  const untrusted = await app.inject({
    method: "POST",
    url: "/api/v1/pages",
    payload: { title: "Domain", actorId: "attacker", source: "untrusted" },
  });
  expect(untrusted.statusCode).toBe(400);
  expect(untrusted.json()).toEqual({ error: "invalid page request" });

  const malformedParent = await app.inject({
    method: "POST",
    url: "/api/v1/pages",
    payload: { title: "Child", parentId: "not-a-native-id" },
  });
  expect(malformedParent.statusCode).toBe(400);
  expect(malformedParent.json()).toEqual({ error: "invalid page request" });

  const missingParent = await app.inject({
    method: "POST",
    url: "/api/v1/pages",
    payload: {
      title: "Child",
      parentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
  });
  expect(missingParent.statusCode).toBe(400);
  expect(missingParent.json()).toEqual({ error: "invalid page hierarchy" });
  await app.close();
});

test("moves a page once and maps stale or cyclic moves to fixed errors", async () => {
  const app = pageApp();
  const firstRoot = await app.inject({
    method: "POST",
    url: "/api/v1/pages",
    payload: { title: "First root" },
  });
  const secondRoot = await app.inject({
    method: "POST",
    url: "/api/v1/pages",
    payload: { title: "Second root" },
  });
  const firstRootId = firstRoot.json().page.id as string;
  const secondRootId = secondRoot.json().page.id as string;
  const child = await app.inject({
    method: "POST",
    url: "/api/v1/pages",
    payload: { title: "Child", parentId: firstRootId },
  });
  const childId = child.json().page.id as string;

  const moved = await app.inject({
    method: "PUT",
    url: "/api/v1/pages/" + childId + "/parent",
    headers: { "if-match": "1" },
    payload: { parentId: secondRootId },
  });
  expect(moved.statusCode).toBe(200);
  expect(moved.json()).toMatchObject({
    page: { id: childId, parentId: secondRootId },
    revisionNumber: 2,
  });

  const stale = await app.inject({
    method: "PUT",
    url: "/api/v1/pages/" + childId + "/parent",
    headers: { "if-match": "1" },
    payload: { parentId: null },
  });
  expect(stale.statusCode).toBe(409);
  expect(stale.json()).toEqual({ error: "page revision conflict" });

  const cyclic = await app.inject({
    method: "PUT",
    url: "/api/v1/pages/" + childId + "/parent",
    headers: { "if-match": "2" },
    payload: { parentId: childId },
  });
  expect(cyclic.statusCode).toBe(400);
  expect(cyclic.json()).toEqual({ error: "invalid page hierarchy" });
  await app.close();
});

test("archives leaves and restores only through a live parent", async () => {
  const app = pageApp();
  const root = await app.inject({
    method: "POST",
    url: "/api/v1/pages",
    payload: { title: "Root" },
  });
  const rootId = root.json().page.id as string;
  const child = await app.inject({
    method: "POST",
    url: "/api/v1/pages",
    payload: { title: "Child", parentId: rootId },
  });
  const childId = child.json().page.id as string;

  const blockedArchive = await app.inject({
    method: "POST",
    url: "/api/v1/pages/" + rootId + "/archive",
    headers: { "if-match": "1" },
    payload: {},
  });
  expect(blockedArchive.statusCode).toBe(400);
  expect(blockedArchive.json()).toEqual({ error: "invalid page hierarchy" });

  const archivedChild = await app.inject({
    method: "POST",
    url: "/api/v1/pages/" + childId + "/archive",
    headers: { "if-match": "1" },
    payload: {},
  });
  expect(archivedChild.statusCode).toBe(200);
  const archivedRoot = await app.inject({
    method: "POST",
    url: "/api/v1/pages/" + rootId + "/archive",
    headers: { "if-match": "1" },
    payload: {},
  });
  expect(archivedRoot.statusCode).toBe(200);

  const archivedTitleEdit = await app.inject({
    method: "PATCH",
    url: "/api/v1/pages/" + childId,
    headers: { "if-match": "2" },
    payload: { title: "Blocked" },
  });
  expect(archivedTitleEdit.statusCode).toBe(409);
  expect(archivedTitleEdit.json()).toEqual({ error: "page is archived" });

  const restoreToArchivedParent = await app.inject({
    method: "PUT",
    url: "/api/v1/pages/" + childId + "/restore",
    headers: { "if-match": "2" },
    payload: { parentId: rootId },
  });
  expect(restoreToArchivedParent.statusCode).toBe(400);
  expect(restoreToArchivedParent.json()).toEqual({
    error: "invalid page hierarchy",
  });

  const restoredRoot = await app.inject({
    method: "PUT",
    url: "/api/v1/pages/" + rootId + "/restore",
    headers: { "if-match": "2" },
    payload: { parentId: null },
  });
  expect(restoredRoot.statusCode).toBe(200);
  const restoredChild = await app.inject({
    method: "PUT",
    url: "/api/v1/pages/" + childId + "/restore",
    headers: { "if-match": "2" },
    payload: { parentId: rootId },
  });
  expect(restoredChild.statusCode).toBe(200);
  expect(restoredChild.json()).toMatchObject({
    page: { id: childId, parentId: rootId, archivedAt: null },
    revisionNumber: 3,
  });
  await app.close();
});

test("enforces shared authorization and CSRF checks on page mutations", async () => {
  const authorize = vi.fn(async (_request, requireCsrf: boolean) => {
    if (requireCsrf) {
      return {
        ok: false as const,
        statusCode: 403 as const,
        error: "CSRF validation failed",
      };
    }
    return {
      ok: true as const,
      actor: {
        actorType: "user" as const,
        actorId: "user-1",
        source: "human-ui",
      },
    };
  });
  const app = pageApp({ authorize });

  const denied = await app.inject({
    method: "POST",
    url: "/api/v1/pages",
    payload: { title: "Denied" },
  });
  expect(denied.statusCode).toBe(403);
  expect(denied.json()).toEqual({ error: "CSRF validation failed" });

  const allowedRead = await app.inject({ method: "GET", url: "/api/v1/pages" });
  expect(allowedRead.statusCode).toBe(200);
  expect(authorize).toHaveBeenCalledWith(expect.anything(), true);
  expect(authorize).toHaveBeenCalledWith(expect.anything(), false);
  await app.close();
});
