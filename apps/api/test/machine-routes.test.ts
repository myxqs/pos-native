import { expect, test } from "vitest";

import { InMemoryDataSourceRepository } from "../../../packages/database/src/data-source-repository.ts";
import { buildApp } from "../src/app.ts";

function machineApp() {
  let nextId = 1;
  const repository = new InMemoryDataSourceRepository();
  const dependencies = {
    newId: () =>
      `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
    now: () => new Date("2026-09-29T12:00:00.000Z"),
  };
  return buildApp({
    dataSourceRepository: repository,
    dataSourceDependencies: dependencies,
    authorize: async () => ({
      ok: true as const,
      actor: {
        actorType: "user" as const,
        actorId: "m5-test",
        source: "machine-api",
      },
    }),
  });
}

test("exposes deterministic machine capabilities, discovery, query and context", async () => {
  const app = machineApp();
  const source = await app.inject({
    method: "POST",
    url: "/api/v1/data-sources",
    payload: { name: "Projects" },
  });
  const sourceId = source.json().source.id as string;
  const created = await app.inject({
    method: "POST",
    url: `/api/v1/data-sources/${sourceId}/items`,
    payload: { title: "Machine project" },
  });
  const recordId = created.json().record.item.id as string;

  const capabilities = await app.inject({
    method: "GET",
    url: "/api/v1/machine/capabilities",
  });
  expect(capabilities.statusCode).toBe(200);
  expect(capabilities.json()).toMatchObject({
    apiVersion: "m5-v1",
    limits: { query: 100, traversalDepth: 3 },
  });

  const schema = await app.inject({
    method: "GET",
    url: "/api/v1/machine/schema",
  });
  expect(
    schema.json().entityTypes.map((type: { name: string }) => type.name),
  ).toEqual(["Page", "Projects"]);

  const query = await app.inject({
    method: "POST",
    url: "/api/v1/machine/query",
    payload: { entityTypeId: sourceId, title: "machine", limit: 10 },
  });
  expect(query.statusCode).toBe(200);
  expect(query.json()).toMatchObject({
    items: [{ id: recordId }],
    nextCursor: null,
    truncated: false,
  });

  const context = await app.inject({
    method: "POST",
    url: "/api/v1/machine/context",
    payload: { recordId, maxProperties: 5, maxRelations: 5 },
  });
  expect(context.statusCode).toBe(200);
  expect(context.json()).toMatchObject({
    entity: { id: recordId },
    omitted: { properties: 0, relations: 0 },
  });
  const history = await app.inject({
    method: "GET",
    url: `/api/v1/machine/entities/${recordId}/history?limit=10`,
  });
  expect(history.statusCode).toBe(200);
  expect(history.json().entries[0]).toMatchObject({
    targetId: recordId,
    actorId: "m5-test",
  });
  expect(history.body).not.toContain("snapshot");
  await app.close();
});

test("rejects unbounded machine queries with stable safe errors", async () => {
  const app = machineApp();
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/machine/query",
    payload: {
      entityTypeId: "00000000-0000-4000-8000-000000000001",
      limit: 10,
    },
  });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({
    error: "machine query is invalid",
    code: "INVALID_QUERY",
  });
  await app.close();
});
