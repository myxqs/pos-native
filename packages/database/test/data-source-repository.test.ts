import { expect, test } from "vitest";

import {
  createDataSource,
  createDataSourceItem,
  createPropertyDefinition,
} from "../../domain/src/data-source.ts";
import { asNativeId, ValidationError } from "../../domain/src/ids.ts";
import { InMemoryDataSourceRepository } from "../src/data-source-repository.ts";
import { PostgresDataSourceRepository } from "../src/postgres-data-source-repository.ts";

const actor = {
  actorType: "user" as const,
  actorId: "user-1",
  source: "human-ui",
};

function dependencies(seed: number) {
  let next = seed * 100;
  return {
    newId: () =>
      `00000000-0000-4000-8000-${(next++).toString().padStart(12, "0")}`,
    now: () => new Date("2026-09-24T10:00:00.000Z"),
  };
}

test("creates a page-backed record with membership and both histories atomically", async () => {
  const repository = new InMemoryDataSourceRepository();
  const source = createDataSource(
    { name: "Projects", ...actor },
    dependencies(1),
  );
  await repository.createSource(source);
  const mutation = createDataSourceItem(
    source.dataSource,
    { title: "Project A", ...actor },
    dependencies(2),
  );

  await repository.createItem(source.dataSource.id, mutation);

  expect(await repository.getItem(mutation.item.id)).toMatchObject({
    item: mutation.item,
    page: mutation.page,
    propertyRevisionNumber: 1,
    values: {},
  });
  expect(await repository.pages.getById(mutation.page.id)).toEqual({
    page: mutation.page,
    revisionNumber: 1,
  });
  expect(repository.revisionsFor("page", mutation.page.id)).toEqual([
    mutation.pageRevision,
  ]);
  expect(repository.revisionsFor("record-property", mutation.item.id)).toEqual([
    mutation.propertyRevision,
  ]);
  expect(repository.auditFor("page", mutation.page.id)).toEqual([
    mutation.pageAudit,
  ]);
  expect(repository.auditFor("record-property", mutation.item.id)).toEqual([
    mutation.propertyAudit,
  ]);
  expect(asNativeId(mutation.page.id)).toBe(mutation.item.id);
});

test("lists sources and records deterministically within explicit bounds", async () => {
  const repository = new InMemoryDataSourceRepository();
  const first = createDataSource({ name: "First", ...actor }, dependencies(30));
  const second = createDataSource(
    { name: "Second", ...actor },
    dependencies(31),
  );
  const third = createDataSource({ name: "Third", ...actor }, dependencies(32));
  await repository.createSource(third);
  await repository.createSource(first);
  await repository.createSource(second);

  await expect(
    repository.listSources({ limit: 2, offset: 1 }),
  ).resolves.toEqual([second.dataSource, third.dataSource]);

  const itemTwo = createDataSourceItem(
    first.dataSource,
    { title: "Two", ...actor },
    dependencies(34),
  );
  const itemOne = createDataSourceItem(
    first.dataSource,
    { title: "One", ...actor },
    dependencies(33),
  );
  await repository.createItem(first.dataSource.id, itemTwo);
  await repository.createItem(first.dataSource.id, itemOne);

  await expect(
    repository.listItems(first.dataSource.id, { limit: 1, offset: 1 }),
  ).resolves.toMatchObject([{ page: { title: "Two" } }]);
  await expect(
    repository.listSources({ limit: 201, offset: 0 }),
  ).rejects.toThrow("invalid list bounds");
});

test("rejects duplicate property names within a source using the canonical name key", async () => {
  const repository = new InMemoryDataSourceRepository();
  const source = createDataSource(
    { name: "Projects", ...actor },
    dependencies(3),
  );
  await repository.createSource(source);
  const first = createPropertyDefinition(
    source.dataSource,
    { name: "Status", kind: "status", options: ["Open"], ...actor },
    dependencies(4),
  );
  const duplicate = createPropertyDefinition(
    source.dataSource,
    { name: "ＳＴＡＴＵＳ", kind: "text", ...actor },
    dependencies(5),
  );
  await repository.createDefinition(source.dataSource.id, first);

  await expect(
    repository.createDefinition(source.dataSource.id, duplicate),
  ).rejects.toThrow("property name already exists");
  expect(await repository.listDefinitions(source.dataSource.id)).toEqual([
    first.definition,
  ]);
});

test("persists typed values and rejects stale property updates without extra history", async () => {
  const repository = new InMemoryDataSourceRepository();
  const source = createDataSource(
    { name: "Projects", ...actor },
    dependencies(6),
  );
  await repository.createSource(source);
  const definition = createPropertyDefinition(
    source.dataSource,
    { name: "Estimate", kind: "number", ...actor },
    dependencies(7),
  );
  await repository.createDefinition(source.dataSource.id, definition);
  const item = createDataSourceItem(
    source.dataSource,
    { title: "Project A", ...actor },
    dependencies(8),
  );
  await repository.createItem(source.dataSource.id, item);

  await repository.setProperty(
    item.item.id,
    definition.definition.id,
    { value: "0012.500", expectedPropertyRevisionNumber: 1, ...actor },
    dependencies(9),
  );
  await expect(
    repository.setProperty(
      item.item.id,
      definition.definition.id,
      { value: "13", expectedPropertyRevisionNumber: 1, ...actor },
      dependencies(10),
    ),
  ).rejects.toThrow("stale property revision");

  expect(await repository.getItem(item.item.id)).toMatchObject({
    values: { [definition.definition.id]: { kind: "number", value: "12.5" } },
    propertyRevisionNumber: 2,
  });
  expect(repository.revisionsFor("record-property", item.item.id)).toHaveLength(
    2,
  );
  expect(repository.auditFor("record-property", item.item.id)).toHaveLength(2);
});

test("adds one live relation, reads it in reverse, and archives it", async () => {
  const repository = new InMemoryDataSourceRepository();
  const source = createDataSource(
    { name: "Projects", ...actor },
    dependencies(11),
  );
  await repository.createSource(source);
  const relation = createPropertyDefinition(
    source.dataSource,
    {
      name: "Related",
      kind: "relation",
      targetSourceId: source.dataSource.id,
      ...actor,
    },
    dependencies(12),
  );
  await repository.createDefinition(source.dataSource.id, relation);
  const first = createDataSourceItem(
    source.dataSource,
    { title: "First", ...actor },
    dependencies(13),
  );
  const second = createDataSourceItem(
    source.dataSource,
    { title: "Second", ...actor },
    dependencies(14),
  );
  await repository.createItem(source.dataSource.id, first);
  await repository.createItem(source.dataSource.id, second);

  const edge = await repository.addRelation(
    first.item.id,
    relation.definition.id,
    second.item.id,
    { expectedPropertyRevisionNumber: 1, ...actor },
    dependencies(15),
  );
  expect(await repository.outgoingRelations(first.item.id)).toEqual([edge]);
  expect(await repository.incomingRelations(second.item.id)).toEqual([edge]);
  await expect(
    repository.addRelation(
      first.item.id,
      relation.definition.id,
      second.item.id,
      { expectedPropertyRevisionNumber: 2, ...actor },
      dependencies(16),
    ),
  ).rejects.toThrow("relation edge already exists");
  await repository.removeRelation(
    edge.id,
    { expectedPropertyRevisionNumber: 2, ...actor },
    dependencies(17),
  );
  expect(await repository.outgoingRelations(first.item.id)).toEqual([]);
  expect(await repository.incomingRelations(second.item.id)).toEqual([]);
  expect(repository.revisionsFor("relation-edge", edge.id)).toHaveLength(2);
  expect(
    repository.revisionsFor("record-property", first.item.id),
  ).toHaveLength(3);
});

test("rejects updates to an archived record page", async () => {
  const repository = new InMemoryDataSourceRepository();
  const source = createDataSource(
    { name: "Projects", ...actor },
    dependencies(18),
  );
  await repository.createSource(source);
  const definition = createPropertyDefinition(
    source.dataSource,
    { name: "Notes", kind: "text", ...actor },
    dependencies(19),
  );
  await repository.createDefinition(source.dataSource.id, definition);
  const item = createDataSourceItem(
    source.dataSource,
    { title: "First", ...actor },
    dependencies(20),
  );
  await repository.createItem(source.dataSource.id, item);
  const { archivePage } = await import("../../domain/src/page.ts");
  await repository.pages.update(
    archivePage(item.page, 1, actor, dependencies(21)),
  );

  await expect(
    repository.setProperty(
      item.item.id,
      definition.definition.id,
      { value: "No", expectedPropertyRevisionNumber: 1, ...actor },
      dependencies(22),
    ),
  ).rejects.toThrow("record page is archived");
  expect(repository.revisionsFor("record-property", item.item.id)).toHaveLength(
    1,
  );
});

test.skipIf(!process.env.TEST_DATABASE_URL)(
  "PostgreSQL returns stable canonical-name conflicts and rejects corrupt persisted keys",
  async () => {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const { Pool } = await import("pg");
    const { fileURLToPath } = await import("node:url");
    const { randomUUID } = await import("node:crypto");
    const schema = await import("../src/schema.ts");
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    try {
      const database = drizzle(pool, { schema });
      await migrate(database, {
        migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
      });
      const repository = new PostgresDataSourceRepository(database);
      const liveDependencies = {
        newId: randomUUID,
        now: () => new Date("2026-09-24T10:00:00.000Z"),
      };
      const source = createDataSource(
        { name: `Concurrent ${randomUUID()}`, ...actor },
        liveDependencies,
      );
      await repository.createSource(source);
      const first = createPropertyDefinition(
        source.dataSource,
        { name: "Status", kind: "text", ...actor },
        liveDependencies,
      );
      const second = createPropertyDefinition(
        source.dataSource,
        { name: "ＳＴＡＴＵＳ", kind: "text", ...actor },
        liveDependencies,
      );

      const outcomes = await Promise.allSettled([
        repository.createDefinition(source.dataSource.id, first),
        repository.createDefinition(source.dataSource.id, second),
      ]);

      expect(
        outcomes.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = outcomes.find((result) => result.status === "rejected");
      expect(rejected).toMatchObject({
        status: "rejected",
        reason: expect.any(ValidationError),
      });
      expect((rejected as PromiseRejectedResult).reason.message).toBe(
        "property name already exists",
      );
      expect(
        await repository.listDefinitions(source.dataSource.id),
      ).toHaveLength(1);
      await pool.query(
        'update "property_definitions" set "name_key" = $1 where "source_id" = $2',
        ["corrupt", source.dataSource.id],
      );
      await expect(
        repository.listDefinitions(source.dataSource.id),
      ).rejects.toThrow("stored property definition is invalid");
    } finally {
      await pool.end();
    }
  },
);

test.skipIf(!process.env.TEST_DATABASE_URL)(
  "PostgreSQL creates a record page and membership in one transaction",
  async () => {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const { Pool } = await import("pg");
    const { fileURLToPath } = await import("node:url");
    const { randomUUID } = await import("node:crypto");
    const schema = await import("../src/schema.ts");
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    try {
      const database = drizzle(pool, { schema });
      await migrate(database, {
        migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
      });
      const repository = new PostgresDataSourceRepository(database);
      const liveDependencies = {
        newId: randomUUID,
        now: () => new Date("2026-09-24T10:00:00.000Z"),
      };
      const source = createDataSource(
        { name: `Projects ${Date.now()}`, ...actor },
        liveDependencies,
      );
      await repository.createSource(source);
      const item = createDataSourceItem(
        source.dataSource,
        { title: "PostgreSQL record", ...actor },
        liveDependencies,
      );
      await repository.createItem(source.dataSource.id, item);
      expect(await repository.getItem(item.item.id)).toMatchObject({
        item: item.item,
        page: item.page,
        propertyRevisionNumber: 1,
      });
      expect(
        await repository.listSources({ limit: 200, offset: 0 }),
      ).toContainEqual(source.dataSource);
      expect(
        await repository.listItems(source.dataSource.id, {
          limit: 100,
          offset: 0,
        }),
      ).toMatchObject([{ item: item.item, page: item.page }]);
    } finally {
      await pool.end();
    }
  },
);

test.skipIf(!process.env.TEST_DATABASE_URL)(
  "PostgreSQL getItem keeps property values and revision in one snapshot across a concurrent write",
  async () => {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const { Pool } = await import("pg");
    const { fileURLToPath } = await import("node:url");
    const { randomUUID } = await import("node:crypto");
    const schema = await import("../src/schema.ts");
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    let beforePageRead: (() => Promise<void>) | null = null;
    pool.on("connect", (client) => {
      const originalQuery = client.query.bind(client);
      client.query = ((...args: unknown[]) => {
        const input = args[0];
        const queryText =
          typeof input === "string"
            ? input
            : typeof input === "object" && input !== null && "text" in input
              ? input.text
              : null;
        if (
          beforePageRead &&
          typeof queryText === "string" &&
          queryText.includes('from "pages"') &&
          queryText.includes('"pages"."id"')
        ) {
          const write = beforePageRead;
          beforePageRead = null;
          const callback = args.at(-1);
          if (typeof callback === "function") {
            void write().then(
              () => Reflect.apply(originalQuery, client, args),
              (error: unknown) => callback(error),
            );
            return undefined;
          }
          return write().then(() => Reflect.apply(originalQuery, client, args));
        }
        return Reflect.apply(originalQuery, client, args);
      }) as typeof client.query;
    });
    try {
      const database = drizzle(pool, { schema });
      await migrate(database, {
        migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
      });
      const repository = new PostgresDataSourceRepository(database);
      const liveDependencies = {
        newId: randomUUID,
        now: () => new Date("2026-09-24T10:00:00.000Z"),
      };
      const source = createDataSource(
        { name: `Snapshot ${randomUUID()}`, ...actor },
        liveDependencies,
      );
      await repository.createSource(source);
      const definition = createPropertyDefinition(
        source.dataSource,
        { name: "Status", kind: "text", ...actor },
        liveDependencies,
      );
      await repository.createDefinition(source.dataSource.id, definition);
      const item = createDataSourceItem(
        source.dataSource,
        { title: "Snapshot record", ...actor },
        liveDependencies,
      );
      await repository.createItem(source.dataSource.id, item);
      await repository.setProperty(
        item.item.id,
        definition.definition.id,
        { value: "before", expectedPropertyRevisionNumber: 1, ...actor },
        liveDependencies,
      );
      beforePageRead = async () => {
        await repository.setProperty(
          item.item.id,
          definition.definition.id,
          { value: "after", expectedPropertyRevisionNumber: 2, ...actor },
          liveDependencies,
        );
      };

      const read = await repository.getItem(item.item.id);
      expect(beforePageRead).toBeNull();
      expect(read).toMatchObject({
        propertyRevisionNumber: 2,
        values: {
          [definition.definition.id]: { kind: "text", value: "before" },
        },
      });
      expect(await repository.getItem(item.item.id)).toMatchObject({
        propertyRevisionNumber: 3,
        values: {
          [definition.definition.id]: { kind: "text", value: "after" },
        },
      });
    } finally {
      await pool.end();
    }
  },
);
