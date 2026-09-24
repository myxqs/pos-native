import { expect, test, vi } from "vitest";

import { InMemoryDataSourceRepository } from "../../../packages/database/src/data-source-repository.ts";
import { buildApp } from "../src/app.ts";
import type { PageAuthorizer } from "../src/page-routes.ts";

function dataSourceApp(authorize?: PageAuthorizer) {
  let nextId = 1;
  const repository = new InMemoryDataSourceRepository();
  const app = buildApp({
    dataSourceRepository: repository,
    dataSourceDependencies: {
      newId: () =>
        `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
      now: () => new Date("2026-09-24T12:00:00.000Z"),
    },
    authorize:
      authorize ??
      (async () => ({
        ok: true as const,
        actor: {
          actorType: "user" as const,
          actorId: "session-user",
          source: "human-ui",
        },
      })),
  });
  return { app, repository };
}

test("creates and reads the minimum structured-data journey", async () => {
  const { app, repository } = dataSourceApp();
  const sourceResponse = await app.inject({
    method: "POST",
    url: "/api/v1/data-sources",
    payload: { name: "Projects" },
  });
  expect(sourceResponse.statusCode).toBe(201);
  const sourceId = sourceResponse.json().source.id as string;

  const definitionResponse = await app.inject({
    method: "POST",
    url: `/api/v1/data-sources/${sourceId}/definitions`,
    payload: { name: "Status", kind: "status", options: ["Open", "Done"] },
  });
  expect(definitionResponse.statusCode).toBe(201);
  const definitionId = definitionResponse.json().definition.id as string;

  const recordResponse = await app.inject({
    method: "POST",
    url: `/api/v1/data-sources/${sourceId}/items`,
    payload: { title: "Ship skeleton" },
  });
  expect(recordResponse.statusCode).toBe(201);
  expect(recordResponse.headers.etag).toBe('"1"');
  const recordId = recordResponse.json().record.item.id as string;

  const updated = await app.inject({
    method: "PUT",
    url: `/api/v1/records/${recordId}/properties/${definitionId}`,
    headers: { "if-match": '"1"' },
    payload: { value: "Open" },
  });
  expect(updated.statusCode).toBe(200);
  expect(updated.headers.etag).toBe('"2"');
  expect(updated.json().record.values[definitionId]).toEqual({
    kind: "status",
    value: "Open",
  });

  const stale = await app.inject({
    method: "PUT",
    url: `/api/v1/records/${recordId}/properties/${definitionId}`,
    headers: { "if-match": '"1"' },
    payload: { value: "Done" },
  });
  expect(stale.statusCode).toBe(409);
  expect(stale.json()).toEqual({ error: "record revision conflict" });

  const relationDefinition = await app.inject({
    method: "POST",
    url: `/api/v1/data-sources/${sourceId}/definitions`,
    payload: { name: "Related", kind: "relation", targetSourceId: sourceId },
  });
  const relationDefinitionId = relationDefinition.json().definition
    .id as string;
  const target = await app.inject({
    method: "POST",
    url: `/api/v1/data-sources/${sourceId}/items`,
    payload: { title: "Target" },
  });
  const targetId = target.json().record.item.id as string;
  const related = await app.inject({
    method: "POST",
    url: `/api/v1/records/${recordId}/relations/${relationDefinitionId}`,
    headers: { "if-match": '"2"' },
    payload: { targetRecordId: targetId },
  });
  expect(related.statusCode).toBe(201);
  expect(related.headers.etag).toBe('"3"');
  const edgeId = related.json().edge.id as string;
  const removed = await app.inject({
    method: "DELETE",
    url: `/api/v1/relations/${edgeId}`,
    headers: { "if-match": '"3"' },
  });
  expect(removed.statusCode).toBe(200);
  expect(removed.headers.etag).toBe('"4"');

  expect(
    (
      await app.inject({
        method: "GET",
        url: "/api/v1/data-sources?limit=1&offset=0",
      })
    ).json(),
  ).toMatchObject({ sources: [{ id: sourceId }] });
  expect(
    (
      await app.inject({
        method: "GET",
        url: `/api/v1/data-sources/${sourceId}/items?limit=1&offset=0`,
      })
    ).json(),
  ).toMatchObject({ records: [{ page: { title: "Ship skeleton" } }] });
  expect(
    (
      await app.inject({ method: "GET", url: `/api/v1/records/${recordId}` })
    ).json(),
  ).toMatchObject({ record: { propertyRevisionNumber: 4 } });
  expect(
    repository.auditFor("data-source", sourceId as never)[0],
  ).toMatchObject({
    actorId: "session-user",
  });
  await app.close();
});

test("requires authorization and CSRF for structured-data mutations", async () => {
  const authorize = vi.fn<PageAuthorizer>(async (_request, requireCsrf) =>
    requireCsrf
      ? { ok: false, statusCode: 403, error: "invalid CSRF token" }
      : {
          ok: true,
          actor: {
            actorType: "user",
            actorId: "session-user",
            source: "human-ui",
          },
        },
  );
  const { app } = dataSourceApp(authorize);
  const denied = await app.inject({
    method: "POST",
    url: "/api/v1/data-sources",
    payload: { name: "Denied" },
  });
  expect(denied.statusCode).toBe(403);
  expect(denied.json()).toEqual({ error: "invalid CSRF token" });
  expect(authorize).toHaveBeenCalledWith(expect.anything(), true);
  await app.close();
});

test("rejects invalid and unbounded structured-data list requests", async () => {
  const { app } = dataSourceApp();
  const invalid = await app.inject({
    method: "GET",
    url: "/api/v1/data-sources?limit=201&offset=0",
  });
  expect(invalid.statusCode).toBe(400);
  expect(invalid.json()).toEqual({ error: "invalid data source query" });
  await app.close();
});
