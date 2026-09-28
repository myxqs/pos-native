import { expect, test } from "vitest";

import { createPageAssetLink } from "../../domain/src/page-asset-link.ts";
import { asNativeId } from "../../domain/src/ids.ts";
import {
  InMemoryPageAssetLinkRepository,
  PageAssetLinkConflictError,
} from "../src/page-asset-link-repository.ts";

const pageId = asNativeId("11111111-1111-4111-8111-111111111111");
const assetId = asNativeId("22222222-2222-4222-8222-222222222222");

function mutation() {
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  return createPageAssetLink(
    { pageId, assetId, actorType: "user", actorId: "owner", source: "test" },
    { newId: () => ids.shift()!, now: () => new Date("2026-09-28T12:00:00Z") },
  );
}

test("persists a link, revision, and audit atomically", async () => {
  const repository = new InMemoryPageAssetLinkRepository();
  const created = mutation();
  await repository.create(created);

  expect(await repository.listForPage(pageId)).toEqual([created.link]);
  expect(repository.revisionsFor(created.link.id)).toEqual([created.revision]);
  expect(repository.auditFor(created.link.id)).toEqual([created.audit]);
});

test("rejects duplicate page and asset links", async () => {
  const repository = new InMemoryPageAssetLinkRepository();
  await repository.create(mutation());
  await expect(repository.create(mutation())).rejects.toBeInstanceOf(
    PageAssetLinkConflictError,
  );
});

test("rolls back the link and history when audit persistence fails", async () => {
  const repository = new InMemoryPageAssetLinkRepository({
    failAt: "before-audit",
  });
  const created = mutation();
  await expect(repository.create(created)).rejects.toThrow("injected failure");
  expect(await repository.listForPage(pageId)).toEqual([]);
  expect(repository.revisionsFor(created.link.id)).toEqual([]);
  expect(repository.auditFor(created.link.id)).toEqual([]);
});

test("a failed later link preserves earlier committed history", async () => {
  const repository = new InMemoryPageAssetLinkRepository({
    failAt: "before-audit",
    failOnAttempt: 2,
  });
  const first = mutation();
  await repository.create(first);
  const secondIds = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ];
  const second = createPageAssetLink(
    {
      pageId,
      assetId: asNativeId("66666666-6666-4666-8666-666666666666"),
      actorType: "user",
      actorId: "owner",
      source: "test",
    },
    {
      newId: () => secondIds.shift()!,
      now: () => new Date("2026-09-28T13:00:00Z"),
    },
  );
  await expect(repository.create(second)).rejects.toThrow("injected failure");
  expect(await repository.listForPage(pageId)).toEqual([first.link]);
  expect(repository.revisionsFor(first.link.id)).toEqual([first.revision]);
  expect(repository.auditFor(first.link.id)).toEqual([first.audit]);
});
