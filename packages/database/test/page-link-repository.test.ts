import { expect, test } from "vitest";
import { asNativeId } from "../../domain/src/ids.ts";
import { archivePageLink, createPageLink } from "../../domain/src/page-link.ts";
import {
  InMemoryPageLinkRepository,
  PageLinkConflictError,
} from "../src/page-link-repository.ts";

const source = asNativeId("11111111-1111-4111-8111-111111111111");
const target = asNativeId("22222222-2222-4222-8222-222222222222");
const pages = new Map<
  ReturnType<typeof asNativeId>,
  { title: string; archivedAt: string | null }
>([
  [source, { title: "Source", archivedAt: null }],
  [target, { title: "Target", archivedAt: null }],
]);
const mutation = () =>
  createPageLink(
    {
      sourcePageId: source,
      targetPageId: target,
      actorType: "user",
      actorId: "owner",
      source: "test",
    },
    {
      newId: () => crypto.randomUUID(),
      now: () => new Date("2026-09-28T12:00:00Z"),
    },
  );

test("lists active forward links and derived backlinks deterministically", async () => {
  const repository = new InMemoryPageLinkRepository(
    (id) => pages.get(id) ?? null,
  );
  const created = mutation();
  await repository.create(created);
  expect(
    await repository.listForward(source, { scope: "active", limit: 20 }),
  ).toEqual([{ link: created.link, page: { id: target, title: "Target" } }]);
  expect(
    await repository.listBacklinks(target, { scope: "active", limit: 20 }),
  ).toEqual([{ link: created.link, page: { id: source, title: "Source" } }]);
  await expect(repository.create(mutation())).rejects.toBeInstanceOf(
    PageLinkConflictError,
  );
});

test("archives recoverably, removes both active directions, and permits a new identity", async () => {
  const repository = new InMemoryPageLinkRepository(
    (id) => pages.get(id) ?? null,
  );
  const created = mutation();
  await repository.create(created);
  const archived = archivePageLink(
    created.link,
    1,
    { actorType: "user", actorId: "owner", source: "test" },
    {
      newId: () => crypto.randomUUID(),
      now: () => new Date("2026-09-28T13:00:00Z"),
    },
  );
  await repository.archive(archived);
  expect(
    await repository.listForward(source, { scope: "active", limit: 20 }),
  ).toEqual([]);
  expect(
    await repository.listBacklinks(target, { scope: "active", limit: 20 }),
  ).toEqual([]);
  expect(
    await repository.listForward(source, { scope: "all", limit: 20 }),
  ).toEqual([{ link: archived.link, page: { id: target, title: "Target" } }]);
  const relink = mutation();
  await repository.create(relink);
  expect(relink.link.id).not.toBe(created.link.id);
});

test.each(["before-revision", "before-audit"] as const)(
  "rolls back creation at %s",
  async (failAt) => {
    const repository = new InMemoryPageLinkRepository(
      (id) => pages.get(id) ?? null,
      { failAt },
    );
    const created = mutation();
    await expect(repository.create(created)).rejects.toThrow(
      "injected failure",
    );
    expect(
      await repository.listForward(source, { scope: "all", limit: 20 }),
    ).toEqual([]);
    expect(repository.revisionsFor(created.link.id)).toEqual([]);
    expect(repository.auditFor(created.link.id)).toEqual([]);
  },
);

test("rejects missing or archived endpoints and suppresses archived endpoint navigation", async () => {
  const repository = new InMemoryPageLinkRepository(
    (id) => pages.get(id) ?? null,
  );
  const created = mutation();
  await repository.create(created);
  pages.set(target, {
    title: "Target",
    archivedAt: "2026-09-28T14:00:00.000Z",
  });
  expect(
    await repository.listForward(source, { scope: "active", limit: 20 }),
  ).toEqual([]);
  await expect(repository.create(mutation())).rejects.toThrow(
    "page link endpoint is archived",
  );
  pages.set(target, { title: "Target", archivedAt: null });
});
