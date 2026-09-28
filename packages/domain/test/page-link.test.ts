import { expect, test } from "vitest";
import { asNativeId } from "../src/ids.ts";
import { archivePageLink, createPageLink } from "../src/page-link.ts";

const sourcePageId = asNativeId("11111111-1111-4111-8111-111111111111");
const targetPageId = asNativeId("22222222-2222-4222-8222-222222222222");

test("creates a stable attributable page link with revision and audit intent", () => {
  const ids = [
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
    "55555555-5555-4555-8555-555555555555",
  ];
  const mutation = createPageLink(
    {
      sourcePageId,
      targetPageId,
      actorType: "user",
      actorId: " owner ",
      source: " browser ",
    },
    { newId: () => ids.shift()!, now: () => new Date("2026-09-28T12:00:00Z") },
  );
  expect(mutation.link).toMatchObject({
    id: asNativeId("33333333-3333-4333-8333-333333333333"),
    sourcePageId,
    targetPageId,
    archivedAt: null,
    provenance: { actorId: "owner", source: "browser" },
  });
  expect(mutation.revision).toMatchObject({
    entityType: "page-link",
    revisionNumber: 1,
    snapshot: mutation.link,
  });
  expect(mutation.audit).toMatchObject({
    action: "page.linked",
    before: null,
    after: mutation.link,
  });
});

test("rejects self links", () => {
  expect(() =>
    createPageLink(
      {
        sourcePageId,
        targetPageId: sourcePageId,
        actorType: "user",
        actorId: "owner",
        source: "test",
      },
      { newId: () => crypto.randomUUID(), now: () => new Date() },
    ),
  ).toThrow("page cannot link to itself");
});

test("archives without changing identity or provenance and increments history", () => {
  const created = createPageLink(
    {
      sourcePageId,
      targetPageId,
      actorType: "user",
      actorId: "owner",
      source: "test",
    },
    {
      newId: () => crypto.randomUUID(),
      now: () => new Date("2026-09-28T12:00:00Z"),
    },
  );
  const archived = archivePageLink(
    created.link,
    1,
    { actorType: "user", actorId: "owner", source: "test" },
    {
      newId: () => crypto.randomUUID(),
      now: () => new Date("2026-09-28T13:00:00Z"),
    },
  );
  expect(archived.link).toEqual({
    ...created.link,
    archivedAt: "2026-09-28T13:00:00.000Z",
  });
  expect(archived.revision.revisionNumber).toBe(2);
  expect(archived.audit).toMatchObject({
    action: "page.unlinked",
    before: created.link,
    after: archived.link,
  });
});
