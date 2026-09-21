import assert from "node:assert/strict";
import { test } from "vitest";

import {
  archivePage,
  createPage,
  movePage,
  PageArchiveStateError,
  restorePage,
  updatePage,
} from "../src/page.ts";
import { ValidationError } from "../src/ids.ts";

test("creates independently identified page, revision, and audit event", () => {
  const generatedIds = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
  ];
  const mutation = createPage(
    {
      title: "Control Centre",
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    {
      newId: () => generatedIds.shift() ?? "",
      now: () => new Date("2026-09-14T12:00:00.000Z"),
    },
  );

  assert.equal(mutation.page.id, "11111111-1111-4111-8111-111111111111");
  assert.equal(mutation.revision.id, "22222222-2222-4222-8222-222222222222");
  assert.equal(mutation.audit.id, "33333333-3333-4333-8333-333333333333");
  assert.equal(mutation.page.title, "Control Centre");
  assert.equal(mutation.page.parentId, null);
  assert.equal(mutation.revision.entityId, mutation.page.id);
  assert.equal(mutation.revision.revisionNumber, 1);
  assert.equal(mutation.audit.action, "page.created");
  assert.equal(mutation.audit.targetId, mutation.page.id);
  assert.equal(mutation.audit.before, null);
  assert.equal(mutation.audit.after.title, "Control Centre");
});

test("creates a child page with its supplied native parent identity", () => {
  const parentId = "11111111-1111-4111-8111-111111111111" as const;
  const mutation = createPage(
    {
      title: "Health",
      parentId: parentId as never,
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    {
      newId: () => "22222222-2222-4222-8222-222222222222",
      now: () => new Date("2026-09-14T12:00:00.000Z"),
    },
  );

  assert.equal(mutation.page.parentId, parentId);
  assert.equal(mutation.revision.snapshot.parentId, parentId);
  assert.equal(mutation.audit.after.parentId, parentId);
});

test("rejects a whitespace-only page title before producing a mutation", () => {
  assert.throws(
    () =>
      createPage(
        {
          title: "   ",
          actorType: "user",
          actorId: "user-1",
          source: "human-ui",
        },
        {
          newId: () => "11111111-1111-4111-8111-111111111111",
          now: () => new Date("2026-09-14T12:00:00.000Z"),
        },
      ),
    /title must not be empty/,
  );
});

test("preserves the actor category and normalises provenance whitespace", () => {
  const mutation = createPage(
    {
      title: "Admin",
      actorType: "api-token",
      actorId: " agent-42 ",
      source: " mcp ",
    },
    {
      newId: () => "44444444-4444-4444-8444-444444444444",
      now: () => new Date("2026-09-14T12:00:00.000Z"),
    },
  );

  assert.equal(mutation.audit.actorType, "api-token");
  assert.equal(mutation.audit.actorId, "agent-42");
  assert.equal(mutation.audit.source, "mcp");
  assert.deepEqual(mutation.page.provenance, {
    source: "mcp",
    actorId: "agent-42",
  });
});

test("rejects an actor category outside the audit contract", () => {
  assert.throws(
    () =>
      createPage(
        {
          title: "Admin",
          actorType: "untrusted-client" as never,
          actorId: "agent-42",
          source: "api",
        },
        {
          newId: () => "55555555-5555-4555-8555-555555555555",
          now: () => new Date("2026-09-14T12:00:00.000Z"),
        },
      ),
    /actor type is not supported/,
  );
});

test("updates a page while preserving identity and recording revision history", () => {
  const original = createPage(
    {
      title: "Control Centre",
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    {
      newId: () => "11111111-1111-4111-8111-111111111111",
      now: () => new Date("2026-09-14T12:00:00.000Z"),
    },
  ).page;
  const generatedIds = [
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
  ];

  const mutation = updatePage(
    original,
    1,
    {
      title: "Life Control Centre",
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    {
      newId: () => generatedIds.shift() ?? "",
      now: () => new Date("2026-09-14T13:00:00.000Z"),
    },
  );

  assert.equal(mutation.page.id, original.id);
  assert.equal(mutation.page.title, "Life Control Centre");
  assert.equal(mutation.page.createdAt, original.createdAt);
  assert.equal(mutation.page.parentId, null);
  assert.equal(mutation.page.modifiedAt, "2026-09-14T13:00:00.000Z");
  assert.equal(mutation.revision.revisionNumber, 2);
  assert.equal(mutation.audit.action, "page.updated");
  assert.deepEqual(mutation.audit.before, original);
  assert.deepEqual(mutation.audit.after, mutation.page);
});

test("moves a live page without changing its native identity", () => {
  const original = createPage(
    {
      title: "Control Centre",
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    {
      newId: () => "11111111-1111-4111-8111-111111111111",
      now: () => new Date("2026-09-14T12:00:00.000Z"),
    },
  ).page;
  const parentId = "44444444-4444-4444-8444-444444444444";
  const generatedIds = [
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
  ];

  const mutation = movePage(
    original,
    1,
    {
      parentId: parentId as never,
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    {
      newId: () => generatedIds.shift() ?? "",
      now: () => new Date("2026-09-14T13:00:00.000Z"),
    },
  );

  assert.equal(mutation.page.id, original.id);
  assert.equal(mutation.page.parentId, parentId);
  assert.equal(mutation.page.title, original.title);
  assert.equal(mutation.revision.revisionNumber, 2);
  assert.equal(mutation.audit.action, "page.moved");
  assert.ok(mutation.audit.before);
  assert.equal(mutation.audit.before.parentId, null);
  assert.equal(mutation.audit.after.parentId, parentId);
});

test("archives and restores a page with distinct recoverable snapshots", () => {
  const original = createPage(
    {
      title: "Control Centre",
      parentId: "44444444-4444-4444-8444-444444444444" as never,
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    {
      newId: () => "11111111-1111-4111-8111-111111111111",
      now: () => new Date("2026-09-14T12:00:00.000Z"),
    },
  ).page;
  const archiveIds = [
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
  ];
  const archived = archivePage(
    original,
    1,
    {
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    {
      newId: () => archiveIds.shift() ?? "",
      now: () => new Date("2026-09-14T13:00:00.000Z"),
    },
  );
  const restoreIds = [
    "55555555-5555-4555-8555-555555555555",
    "66666666-6666-4666-8666-666666666666",
  ];
  const restored = restorePage(
    archived.page,
    2,
    {
      parentId: null,
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    {
      newId: () => restoreIds.shift() ?? "",
      now: () => new Date("2026-09-14T14:00:00.000Z"),
    },
  );

  assert.equal(archived.page.parentId, original.parentId);
  assert.equal(archived.page.archivedAt, "2026-09-14T13:00:00.000Z");
  assert.equal(archived.audit.action, "page.archived");
  assert.ok(archived.audit.before);
  assert.equal(archived.audit.before.archivedAt, null);
  assert.equal(archived.audit.after.archivedAt, archived.page.archivedAt);
  assert.equal(restored.page.id, original.id);
  assert.equal(restored.page.parentId, null);
  assert.equal(restored.page.archivedAt, null);
  assert.equal(restored.page.createdAt, original.createdAt);
  assert.equal(restored.audit.action, "page.restored");
  assert.ok(restored.audit.before);
  assert.equal(restored.audit.before.archivedAt, archived.page.archivedAt);
  assert.equal(restored.audit.after.archivedAt, null);
});

test("rejects malformed parent values and invalid archive-state mutations", () => {
  const live = createPage(
    {
      title: "Control Centre",
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    {
      newId: () => "11111111-1111-4111-8111-111111111111",
      now: () => new Date("2026-09-14T12:00:00.000Z"),
    },
  ).page;
  const archived = {
    ...live,
    archivedAt: "2026-09-14T13:00:00.000Z",
  };
  const context = {
    actorType: "user" as const,
    actorId: "user-1",
    source: "human-ui",
  };
  const dependencies = {
    newId: () => "22222222-2222-4222-8222-222222222222",
    now: () => new Date("2026-09-14T13:00:00.000Z"),
  };

  assert.throws(
    () =>
      createPage(
        { title: "Child", parentId: "not-a-native-id" as never, ...context },
        dependencies,
      ),
    ValidationError,
  );
  assert.throws(
    () =>
      movePage(
        live,
        1,
        { parentId: "not-a-native-id" as never, ...context },
        dependencies,
      ),
    ValidationError,
  );
  assert.throws(
    () => updatePage(archived, 1, { title: "Nope", ...context }, dependencies),
    PageArchiveStateError,
  );
  assert.throws(
    () => movePage(archived, 1, { parentId: null, ...context }, dependencies),
    PageArchiveStateError,
  );
  assert.throws(
    () => archivePage(archived, 1, context, dependencies),
    PageArchiveStateError,
  );
  assert.throws(
    () => restorePage(live, 1, { parentId: null, ...context }, dependencies),
    PageArchiveStateError,
  );
  assert.throws(
    () => archivePage(live, 0, context, dependencies),
    ValidationError,
  );
});
