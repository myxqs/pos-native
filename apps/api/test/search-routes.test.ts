import { expect, test, vi } from "vitest";

import type { SearchRepository } from "../../../packages/database/src/search-repository.ts";
import { buildApp } from "../src/app.ts";
import type { PageAuthorizer } from "../src/page-routes.ts";

const allow: PageAuthorizer = async () => ({
  ok: true,
  actor: { actorType: "user", actorId: "user-1", source: "human-ui" },
});

test("requires authentication and does not query search state", async () => {
  const search = vi.fn(async () => []);
  const app = buildApp({
    searchRepository: { search },
    authorize: async () => ({
      ok: false,
      statusCode: 401,
      error: "authentication required",
    }),
  });
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/search?q=alpha",
  });
  expect(response.statusCode).toBe(401);
  expect(response.json()).toEqual({ error: "authentication required" });
  expect(search).not.toHaveBeenCalled();
  await app.close();
});

test("validates query parameters and enforces default and hard limits", async () => {
  const search = vi.fn(async () => []);
  const app = buildApp({ searchRepository: { search }, authorize: allow });
  for (const url of [
    "/api/v1/search",
    "/api/v1/search?q=a",
    "/api/v1/search?q=alpha&limit=0",
    "/api/v1/search?q=alpha&limit=51",
    "/api/v1/search?q=alpha&extra=true",
  ]) {
    const response = await app.inject({ method: "GET", url });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid search query" });
  }
  await app.inject({ method: "GET", url: "/api/v1/search?q=alpha" });
  await app.inject({ method: "GET", url: "/api/v1/search?q=alpha&limit=7" });
  expect(search).toHaveBeenNthCalledWith(1, { query: "alpha", limit: 20 });
  expect(search).toHaveBeenNthCalledWith(2, { query: "alpha", limit: 7 });
  await app.close();
});

test("returns only the typed navigation result contract", async () => {
  const repository: SearchRepository = {
    search: async () => [
      {
        pageId: "11111111-1111-4111-8111-111111111111",
        pageTitle: "Alpha",
        snippet: "Plain text",
        matchSource: "paragraph",
        rank: 250,
        databaseSecret: "must not leak",
      } as never,
    ],
  };
  const app = buildApp({ searchRepository: repository, authorize: allow });
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/search?q=alpha",
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    results: [
      {
        pageId: "11111111-1111-4111-8111-111111111111",
        pageTitle: "Alpha",
        snippet: "Plain text",
        matchSource: "paragraph",
        rank: 250,
      },
    ],
  });
  await app.close();
});

test("maps repository failures to a generic error", async () => {
  const app = buildApp({
    searchRepository: {
      search: async () => Promise.reject(new Error("password=secret")),
    },
    authorize: allow,
  });
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/search?q=alpha",
  });
  expect(response.statusCode).toBe(500);
  expect(response.json()).toEqual({ error: "search unavailable" });
  expect(response.body).not.toContain("password");
  await app.close();
});

test("rejects malformed repository results without exposing them", async () => {
  const app = buildApp({
    searchRepository: {
      search: async () => [
        {
          pageId: "not-a-page-id",
          pageTitle: "Alpha",
          snippet: "x".repeat(241),
          matchSource: "paragraph",
          rank: 250,
        },
      ],
    },
    authorize: allow,
  });
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/search?q=alpha",
  });
  expect(response.statusCode).toBe(500);
  expect(response.json()).toEqual({ error: "search unavailable" });
  expect(response.body).not.toContain("not-a-page-id");
  await app.close();
});
