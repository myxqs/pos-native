import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";

import type { NativeId } from "../../domain/src/ids.ts";
import {
  archivePage,
  createPage,
  movePage,
  updatePage,
} from "../../domain/src/page.ts";
import { PostgresPageRepository } from "../src/postgres-page-repository.ts";
import {
  PageHierarchyError,
  PageRevisionConflictError,
} from "../src/page-repository.ts";
import * as schema from "../src/schema.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const liveTest = databaseUrl ? test : test.skip;
let pool: Pool | undefined;
let repository: PostgresPageRepository | undefined;

beforeAll(async () => {
  if (!databaseUrl) return;
  pool = new Pool({ connectionString: databaseUrl });
  const database = drizzle(pool, { schema });
  await migrate(database, {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  repository = new PostgresPageRepository(database);
});

beforeEach(async () => {
  if (!pool) return;
  await pool.query("TRUNCATE audit_events, revisions, pages CASCADE");
});

afterAll(async () => {
  await pool?.end();
});

liveTest("persists create and update mutations in PostgreSQL", async () => {
  if (!repository) throw new Error("live repository was not initialised");
  const created = createPage(
    {
      title: "Domain",
      actorType: "user",
      actorId: "integration-user",
      source: "integration-test",
    },
    { newId: randomUUID, now: () => new Date("2026-09-16T10:00:00.000Z") },
  );
  await repository.create(created);
  const updated = updatePage(
    created.page,
    1,
    {
      title: "Projects",
      actorType: "user",
      actorId: "integration-user",
      source: "integration-test",
    },
    { newId: randomUUID, now: () => new Date("2026-09-16T11:00:00.000Z") },
  );

  await repository.update(updated);

  await expect(repository.getById(created.page.id)).resolves.toEqual({
    page: updated.page,
    revisionNumber: 2,
  });
  await expect(repository.list()).resolves.toEqual([updated.page]);
});
liveTest(
  "rejects a stale PostgreSQL page update without overwriting the latest page",
  async () => {
    if (!repository) throw new Error("live repository was not initialised");
    const dependencies = {
      newId: randomUUID,
      now: () => new Date("2026-09-16T10:00:00.000Z"),
    };
    const created = createPage(
      {
        title: "Domain",
        actorType: "user",
        actorId: "integration-user",
        source: "integration-test",
      },
      dependencies,
    );
    await repository.create(created);

    const current = updatePage(
      created.page,
      1,
      {
        title: "Projects",
        actorType: "user",
        actorId: "integration-user",
        source: "integration-test",
      },
      {
        ...dependencies,
        now: () => new Date("2026-09-16T11:00:00.000Z"),
      },
    );
    const stale = updatePage(
      created.page,
      1,
      {
        title: "Stale title",
        actorType: "user",
        actorId: "integration-user",
        source: "integration-test",
      },
      {
        ...dependencies,
        now: () => new Date("2026-09-16T12:00:00.000Z"),
      },
    );
    await repository.update(current);

    await expect(repository.update(stale)).rejects.toBeInstanceOf(
      PageRevisionConflictError,
    );
    await expect(repository.getById(created.page.id)).resolves.toEqual({
      page: current.page,
      revisionNumber: 2,
    });
  },
);

liveTest(
  "persists parent identities and scopes hierarchy navigation",
  async () => {
    if (!repository) throw new Error("live repository was not initialised");
    const root = createPage(
      {
        title: "Root",
        actorType: "user",
        actorId: "integration-user",
        source: "integration-test",
      },
      { newId: randomUUID, now: () => new Date("2026-09-16T10:00:00.000Z") },
    );
    const child = createPage(
      {
        title: "Child",
        parentId: root.page.id,
        actorType: "user",
        actorId: "integration-user",
        source: "integration-test",
      },
      { newId: randomUUID, now: () => new Date("2026-09-16T11:00:00.000Z") },
    );
    await repository.create(root);
    await repository.create(child);

    await expect(repository.getById(child.page.id)).resolves.toEqual({
      page: child.page,
      revisionNumber: 1,
    });
    await expect(repository.list()).resolves.toEqual([root.page, child.page]);

    const archived = archivePage(
      child.page,
      1,
      {
        actorType: "user",
        actorId: "integration-user",
        source: "integration-test",
      },
      { newId: randomUUID, now: () => new Date("2026-09-16T12:00:00.000Z") },
    );
    await repository.update(archived);
    await expect(repository.list()).resolves.toEqual([root.page]);
    await expect(repository.list("archived")).resolves.toEqual([archived.page]);
  },
);

liveTest(
  "rejects an invalid hierarchy mutation without appending PostgreSQL history",
  async () => {
    if (!repository) throw new Error("live repository was not initialised");
    const root = createPage(
      {
        title: "Root",
        actorType: "user",
        actorId: "integration-user",
        source: "integration-test",
      },
      {
        newId: randomUUID,
        now: () => new Date("2026-09-16T10:00:00.000Z"),
      },
    );
    await repository.create(root);
    const invalid = movePage(
      root.page,
      1,
      {
        parentId: root.page.id,
        actorType: "user",
        actorId: "integration-user",
        source: "integration-test",
      },
      {
        newId: randomUUID,
        now: () => new Date("2026-09-16T11:00:00.000Z"),
      },
    );

    await expect(repository.update(invalid)).rejects.toBeInstanceOf(
      PageHierarchyError,
    );
    await expect(repository.getById(root.page.id)).resolves.toEqual({
      page: root.page,
      revisionNumber: 1,
    });
  },
);

liveTest(
  "rejects a PostgreSQL subtree move when a live or archived descendant would exceed 32 parent edges",
  async () => {
    if (!repository) throw new Error("live repository was not initialised");
    const command = (title: string, parentId: NativeId | null = null) =>
      createPage(
        {
          title,
          ...(parentId === null ? {} : { parentId }),
          actorType: "user",
          actorId: "integration-user",
          source: "integration-test",
        },
        {
          newId: randomUUID,
          now: () => new Date("2026-09-16T10:00:00.000Z"),
        },
      );

    let destination = command("Destination root");
    await repository.create(destination);
    for (let depth = 1; depth <= 31; depth += 1) {
      const child = command(`Destination ${depth}`, destination.page.id);
      await repository.create(child);
      destination = child;
    }

    const subtreeRoot = command("Subtree root");
    const subtreeChild = command("Subtree child", subtreeRoot.page.id);
    await repository.create(subtreeRoot);
    await repository.create(subtreeChild);

    const moveWithLiveDescendant = movePage(
      subtreeRoot.page,
      1,
      {
        parentId: destination.page.id,
        actorType: "user",
        actorId: "integration-user",
        source: "integration-test",
      },
      {
        newId: randomUUID,
        now: () => new Date("2026-09-16T11:00:00.000Z"),
      },
    );
    await expect(
      repository.update(moveWithLiveDescendant),
    ).rejects.toBeInstanceOf(PageHierarchyError);
    await expect(repository.getById(subtreeRoot.page.id)).resolves.toEqual({
      page: subtreeRoot.page,
      revisionNumber: 1,
    });

    const archivedChild = archivePage(
      subtreeChild.page,
      1,
      {
        actorType: "user",
        actorId: "integration-user",
        source: "integration-test",
      },
      {
        newId: randomUUID,
        now: () => new Date("2026-09-16T12:00:00.000Z"),
      },
    );
    await repository.update(archivedChild);

    const moveWithArchivedDescendant = movePage(
      subtreeRoot.page,
      1,
      {
        parentId: destination.page.id,
        actorType: "user",
        actorId: "integration-user",
        source: "integration-test",
      },
      {
        newId: randomUUID,
        now: () => new Date("2026-09-16T13:00:00.000Z"),
      },
    );
    await expect(
      repository.update(moveWithArchivedDescendant),
    ).rejects.toBeInstanceOf(PageHierarchyError);
    await expect(repository.getById(subtreeRoot.page.id)).resolves.toEqual({
      page: subtreeRoot.page,
      revisionNumber: 1,
    });
  },
);

liveTest(
  "serializes two independently valid moves that would otherwise form a cycle",
  async () => {
    if (!repository) throw new Error("live repository was not initialised");
    const command = (title: string, parentId: NativeId | null = null) =>
      createPage(
        {
          title,
          ...(parentId === null ? {} : { parentId }),
          actorType: "user",
          actorId: "integration-user",
          source: "integration-test",
        },
        {
          newId: randomUUID,
          now: () => new Date("2026-09-16T10:00:00.000Z"),
        },
      );
    const firstRoot = command("First root");
    const secondRoot = command("Second root");
    const firstChild = command("First child", firstRoot.page.id);
    const secondChild = command("Second child", secondRoot.page.id);
    await repository.create(firstRoot);
    await repository.create(secondRoot);
    await repository.create(firstChild);
    await repository.create(secondChild);

    const firstMove = movePage(
      firstRoot.page,
      1,
      {
        parentId: secondChild.page.id,
        actorType: "user",
        actorId: "integration-user",
        source: "integration-test",
      },
      { newId: randomUUID, now: () => new Date("2026-09-16T11:00:00.000Z") },
    );
    const secondMove = movePage(
      secondRoot.page,
      1,
      {
        parentId: firstChild.page.id,
        actorType: "user",
        actorId: "integration-user",
        source: "integration-test",
      },
      { newId: randomUUID, now: () => new Date("2026-09-16T11:00:00.000Z") },
    );

    const outcomes = await Promise.allSettled([
      repository.update(firstMove),
      repository.update(secondMove),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
  },
);
