import { expect, test } from "vitest";

import { createPage, updatePage } from "../../domain/src/page.ts";
import { InMemoryPageRepository } from "../src/page-repository.ts";

const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];

function pageCreation() {
  const generated = [...ids];
  return createPage(
    {
      title: "Domain",
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    {
      newId: () => generated.shift() ?? "",
      now: () => new Date("2026-09-16T10:00:00.000Z"),
    },
  );
}

test("persists a page with its revision and audit event as one mutation", async () => {
  const repository = new InMemoryPageRepository();
  const mutation = pageCreation();

  await repository.create(mutation);

  await expect(repository.getById(mutation.page.id)).resolves.toEqual({
    page: mutation.page,
    revisionNumber: 1,
  });
  await expect(repository.list()).resolves.toEqual([mutation.page]);
  expect(repository.revisionsFor(mutation.page.id)).toEqual([
    mutation.revision,
  ]);
  expect(repository.auditFor(mutation.page.id)).toEqual([mutation.audit]);
});

test("updates the existing page and appends revision and audit history", async () => {
  const repository = new InMemoryPageRepository();
  const created = pageCreation();
  await repository.create(created);
  const generated = [
    "44444444-4444-4444-8444-444444444444",
    "55555555-5555-4555-8555-555555555555",
  ];
  const updated = updatePage(
    created.page,
    1,
    {
      title: "Projects",
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    {
      newId: () => generated.shift() ?? "",
      now: () => new Date("2026-09-16T11:00:00.000Z"),
    },
  );

  await repository.update(updated);

  await expect(repository.getById(created.page.id)).resolves.toEqual({
    page: updated.page,
    revisionNumber: 2,
  });
  expect(repository.revisionsFor(created.page.id)).toHaveLength(2);
  expect(repository.auditFor(created.page.id)).toHaveLength(2);
});

test("rolls back every write when a create mutation fails after the page write", async () => {
  const repository = new InMemoryPageRepository({
    failAt: "before-revision",
  });
  const mutation = pageCreation();

  await expect(repository.create(mutation)).rejects.toThrow(
    "injected failure before revision",
  );

  await expect(repository.getById(mutation.page.id)).resolves.toBeNull();
  await expect(repository.list()).resolves.toEqual([]);
  expect(repository.revisionsFor(mutation.page.id)).toEqual([]);
  expect(repository.auditFor(mutation.page.id)).toEqual([]);
});
