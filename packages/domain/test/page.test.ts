import assert from "node:assert/strict";
import { test } from "vitest";

import { createPage, updatePage } from "../src/page.ts";

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
  assert.equal(mutation.revision.entityId, mutation.page.id);
  assert.equal(mutation.revision.revisionNumber, 1);
  assert.equal(mutation.audit.action, "page.created");
  assert.equal(mutation.audit.targetId, mutation.page.id);
  assert.equal(mutation.audit.before, null);
  assert.equal(mutation.audit.after.title, "Control Centre");
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
  assert.equal(mutation.page.modifiedAt, "2026-09-14T13:00:00.000Z");
  assert.equal(mutation.revision.revisionNumber, 2);
  assert.equal(mutation.audit.action, "page.updated");
  assert.deepEqual(mutation.audit.before, original);
  assert.deepEqual(mutation.audit.after, mutation.page);
});
