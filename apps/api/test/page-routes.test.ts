import { expect, test } from "vitest";

import { InMemoryPageRepository } from "../../../packages/database/src/page-repository.ts";
import { buildApp } from "../src/app.ts";

function pageApp() {
  const generatedIds = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
    "55555555-5555-4555-8555-555555555555",
  ];
  return buildApp({
    pageRepository: new InMemoryPageRepository(),
    pageDependencies: {
      newId: () => generatedIds.shift() ?? "",
      now: () => new Date("2026-09-16T12:00:00.000Z"),
    },
    authorize: async () => ({
      ok: true,
      actor: { actorType: "user", actorId: "user-1", source: "human-ui" },
    }),
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

  const read = await app.inject({ method: "GET", url: `/api/v1/pages/${id}` });
  expect(read.statusCode).toBe(200);
  expect(read.json()).toMatchObject({
    page: { id, title: "Domain" },
    revisionNumber: 1,
  });

  const updated = await app.inject({
    method: "PATCH",
    url: `/api/v1/pages/${id}`,
    payload: { title: "Projects" },
  });
  expect(updated.statusCode).toBe(200);
  expect(updated.json()).toMatchObject({
    page: { id, title: "Projects" },
    revisionNumber: 2,
  });
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
